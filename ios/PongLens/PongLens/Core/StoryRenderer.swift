import AVFoundation
import CoreGraphics
import CoreText
import Foundation
import CoreImage
import UIKit

/// Building the 9:16 share clip on the phone instead of on the Mac.
///
/// The parallel of `render_story` in worker.py, and deliberately a parallel
/// rather than a replacement — which path runs is one row in app_config, so
/// both can be exercised on the same build and either can be turned off
/// without shipping anything.
///
/// What it does NOT do is re-derive anything. The crop window was worked
/// out once on the server from the table quad and stored on the match row;
/// this applies that rectangle. The score comes from computeMatchScore, the
/// same walk the match page draws from. The only thing that genuinely
/// exists twice is the band artwork, and that is drawn from the same
/// numbers as the worker's so the two stay comparable.
///
/// Measured on Apple silicon: ~0.8 s of compute for a 9 s rally, of which
/// the overlay is 58 ms. The floor of the supported fleet is the A13
/// (iPhone 11 — iOS 26 will not install on anything older), where the same
/// work is expected to take two to four seconds. It is all fixed-function
/// video engine, not CPU, which is why an older phone is slower rather
/// than incapable.
enum StoryRenderer {
    static let canvas = CGSize(width: 1080, height: 1920)
    /// Instagram draws its own header and reply bar over these.
    static let safeTop: CGFloat = 260
    static let safeBottom: CGFloat = 300

    struct Crop: Decodable {
        let x: Int, y: Int, w: Int, h: Int
        let src_w: Int, src_h: Int
    }

    enum RenderError: LocalizedError {
        case noVideoTrack
        case exportFailed(String)

        var errorDescription: String? {
            switch self {
            case .noVideoTrack: "That match's video couldn't be read."
            case .exportFailed(let why): why
            }
        }
    }

    /// Render one rally. `cutURL` is a signed URL for the match's cut
    /// video — AVFoundation range-reads it rather than downloading, which
    /// is the whole reason this is viable: a rally is about 10 MB out of a
    /// file that can run to hundreds.
    static func render(
        cutURL: URL,
        segStart: Double,
        segEnd: Double,
        crop: Crop?,
        you: String,
        them: String,
        score: (you: Int, them: Int)?,
        games: [(Int, Int)],
        showNames: Bool = true,
        showLogo: Bool = true
    ) async throws -> URL {
        let asset = AVURLAsset(url: cutURL)
        guard let vTrack = try await asset.loadTracks(withMediaType: .video).first
        else { throw RenderError.noVideoTrack }
        let natural = try await vTrack.load(.naturalSize)
        let nominalFPS = (try? await vTrack.load(.nominalFrameRate)) ?? 0

        let duration = try await asset.load(.duration).seconds
        let s0 = max(0, segStart)
        let s1 = min(segEnd, duration.isFinite ? duration : segEnd)
        let range = CMTimeRange(
            start: CMTime(seconds: s0, preferredTimescale: 600),
            duration: CMTime(seconds: max(0.5, s1 - s0), preferredTimescale: 600))

        let comp = AVMutableComposition()
        guard let cv = comp.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw RenderError.noVideoTrack }
        try cv.insertTimeRange(range, of: vTrack, at: .zero)
        if let aTrack = try await asset.loadTracks(withMediaType: .audio).first,
           let ca = comp.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            // A rally with no audio is not an error; the clip is just silent.
            try? ca.insertTimeRange(range, of: aTrack, at: .zero)
        }

        // The stored window is in the SOURCE video's pixels. Use it only if
        // this really is a source of that size — a reprocess at another
        // resolution must not be cropped with a window measured against the
        // old one. Otherwise show the whole frame, which is what a share
        // did before any of this existed.
        let usable: Crop? = {
            guard let c = crop,
                  c.src_w == Int(natural.width.rounded()),
                  c.src_h == Int(natural.height.rounded()),
                  c.w > 0, c.h > 0,
                  // The transform below is horizontal-only, which is all
                  // story_crop_window ever emits. A vertical component
                  // appearing upstream must fall back to the full frame
                  // here, not silently mis-frame every phone render.
                  c.y == 0, c.h == c.src_h else { return nil }
            return c
        }()
        let cropX = CGFloat(usable?.x ?? 0)
        let cropW = CGFloat(usable?.w ?? Int(natural.width))
        let cropH = CGFloat(usable?.h ?? Int(natural.height))

        var scale = canvas.width / cropW
        var shownH = cropH * scale
        if shownH > canvas.height {          // a portrait source fits by height
            scale = canvas.height / cropH
            shownH = canvas.height
        }
        let shownW = cropW * scale
        let vx = (canvas.width - shownW) / 2
        let vy = (canvas.height - shownH) / 2

        // Composited with Core Image, NOT AVVideoCompositionCoreAnimationTool.
        //
        // The Core Animation tool is the usual way to lay artwork over an
        // export, and it works on macOS — but in the iOS Simulator its
        // offline renderer goes through IOSurface over XPC and trips an
        // api-misuse trap, taking the app down with SIGTRAP inside
        // CA::OGL::render_layers. Core Image stays on the GPU, has no such
        // dependency, runs in the Simulator, and needs no layer tree.
        guard let artwork = bandArtwork(
            videoY: vy, videoH: shownH, videoX: vx, videoW: shownW,
            you: you, them: them, score: score, games: games,
            showNames: showNames, showLogo: showLogo)
        else { throw RenderError.exportFailed("Couldn't draw the frame.") }

        let band = CIImage(cgImage: artwork)
        let canvasRect = CGRect(origin: .zero, size: canvas)
        let ground = CIImage(color: CIColor(red: 10/255, green: 10/255,
                                            blue: 18/255))
            .cropped(to: canvasRect)
        // The crop is horizontal only (y = 0, full height), so Core Image's
        // bottom-left origin needs no flip here — and the video is centred
        // vertically, so vy reads the same from either edge.
        let place = CGAffineTransform(translationX: -cropX, y: 0)
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: vx, y: vy))

        let vcompCI = AVMutableVideoComposition(
            asset: comp, applyingCIFiltersWithHandler: { request in
                let placed = request.sourceImage
                    .cropped(to: CGRect(x: cropX, y: 0,
                                        width: cropW, height: cropH))
                    .transformed(by: place)
                request.finish(
                    with: band
                        .composited(over: placed.composited(over: ground))
                        .cropped(to: canvasRect),
                    context: nil)
            })
        vcompCI.renderSize = canvas
        // The source's own clock, not a flat 30 — halving a 60 fps rally
        // is visible exactly where it moves fastest. Instagram tops out at
        // 60; an unreadable rate falls back to 30.
        let fps: Int32 = nominalFPS > 0
            ? Int32(min(60, max(24, nominalFPS.rounded()))) : 30
        vcompCI.frameDuration = CMTime(value: 1, timescale: fps)
        let vcompFinal = vcompCI

        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("story-\(UUID().uuidString).mp4")
        try? FileManager.default.removeItem(at: out)
        guard let ex = AVAssetExportSession(
            asset: comp, presetName: AVAssetExportPreset1920x1080)
        else { throw RenderError.exportFailed("Couldn't prepare the clip.") }
        ex.videoComposition = vcompFinal
        ex.shouldOptimizeForNetworkUse = true   // faststart, so Instagram
                                                // does not buffer the lot
        do {
            try await ex.export(to: out, as: .mp4)
        } catch {
            throw RenderError.exportFailed(
                "Couldn't prepare the clip. \(error.localizedDescription)")
        }
        return out
    }

    // MARK: - The bands
    //
    // Drawn once into an image rather than as text layers. A CATextLayer
    // depends on a layout pass that is not guaranteed in an offline render,
    // and the artwork is fixed for the whole clip anyway. Same reason the
    // worker draws it once with PIL.
    //
    // Geometry is deliberately the same arithmetic as _story_background in
    // worker.py, so a change to one is visible as a difference against the
    // other rather than hiding.

    private static func bandArtwork(
        videoY vy: CGFloat, videoH: CGFloat, videoX vx: CGFloat, videoW: CGFloat,
        you: String, them: String, score: (you: Int, them: Int)?,
        games: [(Int, Int)], showNames: Bool, showLogo: Bool
    ) -> CGImage? {
        let W = Int(canvas.width), H = Int(canvas.height)
        guard let ctx = CGContext(
            data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }

        // Work top-down like the worker does, so the two sets of numbers
        // can be read side by side.
        ctx.translateBy(x: 0, y: canvas.height)
        ctx.scaleBy(x: 1, y: -1)

        let ink = CGColor(red: 10/255, green: 10/255, blue: 18/255, alpha: 1)
        let cyan = CGColor(red: 34/255, green: 211/255, blue: 238/255, alpha: 1)
        let white = CGColor(red: 244/255, green: 244/255, blue: 245/255, alpha: 1)
        let muted = CGColor(red: 161/255, green: 161/255, blue: 170/255, alpha: 1)

        ctx.setFillColor(ink)
        ctx.fill(CGRect(origin: .zero, size: canvas))
        // The site's cyan bloom, top-centre, and a magenta hint upper right.
        drawBloom(ctx)
        // Punch the picture area out so the video shows through.
        ctx.setBlendMode(.copy)
        ctx.setFillColor(CGColor(gray: 0, alpha: 0))
        ctx.fill(CGRect(x: vx, y: vy, width: videoW, height: videoH))
        ctx.setBlendMode(.normal)
        // Hairline, so the picture has an edge against the ink.
        ctx.setStrokeColor(CGColor(gray: 1, alpha: 0.12))
        ctx.setLineWidth(2)
        ctx.stroke(CGRect(x: vx, y: vy, width: videoW, height: videoH))

        let margin: CGFloat = 72
        let top = max(safeTop, vy - 210)
        if showNames {
            text(ctx, fit(you, 22).uppercased(), 30, "HelveticaNeue-Medium",
                 cyan, at: CGPoint(x: margin, y: top))
            text(ctx, "vs \(fit(them, 20))", 52, "HelveticaNeue-Bold",
                 white, at: CGPoint(x: margin, y: top + 44))
        }
        if let score {
            // Inset further than the names: Instagram's own icon rail runs
            // down the composer's right edge and sat over the score at 72.
            let scoreRight = canvas.width - 150
            text(ctx, "\(score.you) – \(score.them)", 84, "HelveticaNeue-Bold",
                 white, at: CGPoint(x: scoreRight, y: top + 18),
                 rightAligned: true)
            if !games.isEmpty {
                let line = games.map { "\($0.0)-\($0.1)" }.joined(separator: "   ")
                text(ctx, line, 28, "HelveticaNeue-Medium", muted,
                     at: CGPoint(x: scoreRight, y: top + 118),
                     rightAligned: true)
            }
        }

        // The mark stays unless the owner switched it off in the share
        // sheet — mirrors _story_background's show_logo.
        if showLogo {
            let markY = min(canvas.height - safeBottom, vy + videoH + 130)
            drawMark(ctx, centreY: markY, cyan: cyan, white: white)
        }
        return ctx.makeImage()
    }

    private static func drawBloom(_ ctx: CGContext) {
        ctx.saveGState()
        for (rect, colour) in [
            (CGRect(x: -canvas.width * 0.35, y: -canvas.height * 0.16,
                    width: canvas.width * 1.7, height: canvas.height * 0.40),
             CGColor(red: 34/255, green: 211/255, blue: 238/255, alpha: 0.10)),
            (CGRect(x: canvas.width * 0.5, y: -canvas.height * 0.05,
                    width: canvas.width * 0.7, height: canvas.height * 0.20),
             CGColor(red: 232/255, green: 121/255, blue: 249/255, alpha: 0.06)),
        ] {
            let colours = [colour, colour.copy(alpha: 0)!] as CFArray
            guard let g = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colours, locations: [0, 1]) else { continue }
            ctx.saveGState()
            ctx.addEllipse(in: rect)
            ctx.clip()
            ctx.drawRadialGradient(
                g, startCenter: CGPoint(x: rect.midX, y: rect.midY),
                startRadius: 0,
                endCenter: CGPoint(x: rect.midX, y: rect.midY),
                endRadius: max(rect.width, rect.height) / 2,
                options: [])
            ctx.restoreGState()
        }
        ctx.restoreGState()
    }

    /// The Logo.tsx lens-ring glyph beside the wordmark, in the frame's
    /// bottom-right corner — a signature, not a title. Geometry
    /// mirrors _draw_lens_mark: ring r=12 stroke 2.5, glint arc r=8.25
    /// stroke 2 from 210 to 285 degrees, on a 32-unit box.
    private static func drawMark(_ ctx: CGContext, centreY: CGFloat,
                                 cyan: CGColor, white: CGColor) {
        let box: CGFloat = 46
        let label = "PongLens"
        let labelW = textWidth(label, 38, "HelveticaNeue-Bold")
        let gap: CGFloat = 16
        let x0 = canvas.width - 72 - (box + gap + labelW)
        let k = box / 32
        let cx = x0 + box / 2

        ctx.saveGState()
        ctx.setStrokeColor(cyan.copy(alpha: 0.95)!)
        ctx.setLineWidth(2.5 * k)
        ctx.addArc(center: CGPoint(x: cx, y: centreY), radius: 12 * k,
                   startAngle: 0, endAngle: .pi * 2, clockwise: false)
        ctx.strokePath()
        ctx.setStrokeColor(cyan.copy(alpha: 0.5)!)
        ctx.setLineWidth(2 * k)
        ctx.setLineCap(.round)
        ctx.addArc(center: CGPoint(x: cx, y: centreY), radius: 8.25 * k,
                   startAngle: .pi * 210 / 180, endAngle: .pi * 285 / 180,
                   clockwise: false)
        ctx.strokePath()
        ctx.restoreGState()

        text(ctx, label, 38, "HelveticaNeue-Bold", white.copy(alpha: 0.92)!,
             at: CGPoint(x: x0 + box + gap, y: centreY - 19))
    }

    // MARK: text helpers (top-down coordinates)

    private static func font(_ size: CGFloat, _ name: String) -> CTFont {
        CTFontCreateWithName(name as CFString, size, nil)
    }

    private static func line(_ s: String, _ size: CGFloat, _ name: String,
                             _ colour: CGColor) -> CTLine {
        CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font(size, name),
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): colour,
        ]))
    }

    private static func textWidth(_ s: String, _ size: CGFloat,
                                  _ name: String) -> CGFloat {
        CGFloat(CTLineGetTypographicBounds(
            line(s, size, name, CGColor(gray: 1, alpha: 1)), nil, nil, nil))
    }

    /// `at` is the TOP-left (or top-right) of the text, matching the
    /// worker's coordinates. Core Text draws from a baseline, so the
    /// ascent is added here rather than in every call site.
    private static func text(_ ctx: CGContext, _ s: String, _ size: CGFloat,
                             _ name: String, _ colour: CGColor,
                             at p: CGPoint, rightAligned: Bool = false) {
        let l = line(s, size, name, colour)
        var ascent: CGFloat = 0
        let w = CGFloat(CTLineGetTypographicBounds(l, &ascent, nil, nil))
        ctx.saveGState()
        // Flip back for the glyphs themselves, which are drawn bottom-up.
        ctx.translateBy(x: rightAligned ? p.x - w : p.x, y: p.y + ascent)
        ctx.scaleBy(x: 1, y: -1)
        ctx.textPosition = .zero
        CTLineDraw(l, ctx)
        ctx.restoreGState()
    }

    private static func fit(_ s: String, _ limit: Int) -> String {
        let t = s.trimmingCharacters(in: .whitespaces)
        if t.isEmpty { return "Player" }
        return t.count <= limit ? t : String(t.prefix(limit - 1)) + "…"
    }
}
