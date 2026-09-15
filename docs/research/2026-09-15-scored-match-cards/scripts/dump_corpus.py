"""Read-only dump of candidate matches (match row + every point row) to JSON."""
import json, os, subprocess, sys
import psycopg2, psycopg2.extras

CORPUS = [
    ("77fc4dee-3de6-47d6-a2df-df85e239535c", "lester"),
    ("cebaa6d4-81e4-4aab-b4fa-1ed485685d00", "rowel"),
    ("9e15ed10-f595-4efc-85c8-74cce08eb9c5", "prabhas"),
    ("d59d7610-d087-42ec-a1a6-b532fb4cac96", "ishan"),
    ("a52a6612-7c4d-489e-b5c1-50c437cad931", "ali"),
    ("ec6490f4-b835-4d82-882a-8fb2f1abc2e5", "chris_aug22"),
    ("7e02fbb9-a3af-4686-84bc-d4b961ab9fed", "julian_aug23"),
    ("89b35ee0-01f9-4c01-a966-6305b6e96d4a", "yuyulin"),
    ("8cb54f9f-8236-488d-bf86-074a9525e63b", "brian"),
    ("28a0bc1e-772c-405e-91f2-f8d900b20780", "anton"),
    ("bfe1043c-d134-4844-9906-140d80cc5a1e", "vaibhav_sep4"),
    ("c668b36c-b04a-43ef-8306-faa878320154", "chris_aug14"),
    ("0ab28972-86df-44df-a3e6-65fe356c5171", "julian_oct25"),
    ("2eab3e3d-c4df-46ff-b0e2-2c6698fb2c69", "terry2"),
    ("9bd87661-f4d9-42f3-9767-2cfc486474d8", "vaibhav_wtc"),
    ("ebbb8f94-def1-493d-85df-f37c28afe0a7", "chris_jul26b"),
    ("8e17b962-e26e-454a-9fe2-8f7c0a3a61de", "chris_jul26a"),
    ("d3c7827e-d576-427b-9b79-1e4ebeaf7ee6", "chris_jul26c"),
    ("19a1efc7-e770-40ab-989a-4a24b1503549", "julian_aug11_pinkrim"),
]

def keychain(service):
    return subprocess.check_output(["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"]).decode().strip()

def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    conn = psycopg2.connect(os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"))
    conn.set_session(readonly=True)
    manifest = []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        for match_id, slug in CORPUS:
            cur.execute("select m.* from public.matches m where m.id = %s", (match_id,))
            match = cur.fetchone()
            if match is None:
                print(f"{slug}: missing"); continue
            cur.execute("select * from public.points where match_id = %s order by idx", (match_id,))
            points = cur.fetchall()
            cur.execute("select * from public.point_boundaries where match_id = %s order by idx", (match_id,))
            bounds = cur.fetchall()
            with open(os.path.join(out_dir, f"{slug}.json"), "w") as fh:
                json.dump({"match": match, "points": points, "boundaries": bounds}, fh, default=str)
            live = [p for p in points if not p["deleted"]]
            scored = sum(1 for p in live if p["confirmed_winner"])
            v3 = sum(1 for p in live if (p["placement"] or {}).get("v") == 3)
            manifest.append({"slug": slug, "id": match_id, "opponent": match["opponent_name"], "venue": match["venue"],
                             "played_at": str(match["played_at"]), "user_side": match["user_side"], "first_server": match["first_server"],
                             "live": len(live), "scored": scored, "v3": v3, "boundaries": len(bounds)})
            print(f"{slug:22s} live={len(live):4d} scored={scored:4d} v3={v3:4d} bounds={len(bounds):3d}")
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

if __name__ == "__main__":
    main()
