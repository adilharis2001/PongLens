import UIKit

/// The app hides every navigation bar and draws its own back controls,
/// which by default also kills UIKit's interactive pop — the edge swipe
/// every iPhone hand expects. Re-attach the gesture ourselves: it may
/// begin whenever there is somewhere to pop back to.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}
