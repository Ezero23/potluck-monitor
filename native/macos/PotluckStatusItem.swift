import AppKit
import Darwin

final class StatusItemDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setbuf(stdout, nil)

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = item.button else {
            emit("error\tmissing-button")
            NSApp.terminate(nil)
            return
        }

        let bundledIcon = Bundle.main.url(
            forResource: "tray-token-monitor",
            withExtension: "png"
        ).flatMap(NSImage.init(contentsOf:))
        if let image = bundledIcon ?? NSImage(
            systemSymbolName: "circle",
            accessibilityDescription: "Potluck Monitor"
        ) {
            image.size = NSSize(width: 18, height: 18)
            image.isTemplate = true
            button.image = image
        } else {
            button.title = "P"
        }
        button.toolTip = "Potluck Monitor"
        button.target = self
        button.action = #selector(handleStatusItemClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem = item

        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                self?.handleCommand(line)
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }

        emit("ready")
    }

    @objc private func handleStatusItemClick(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
            return
        }

        let frame = sender.window?.frame ?? .zero
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(frame) }) ?? NSScreen.main
        let top = screen.map { $0.frame.maxY - frame.maxY + $0.frame.minY } ?? 0
        emit("toggle\t\(Int(frame.minX))\t\(Int(top))\t\(Int(frame.width))\t\(Int(frame.height))")
    }

    private func showMenu() {
        guard let item = statusItem, let button = item.button else { return }
        let menu = NSMenu()
        menu.addItem(menuItem("Open Potluck Monitor", action: #selector(openApp)))
        menu.addItem(menuItem("Refresh Now", action: #selector(refresh)))
        menu.addItem(.separator())
        menu.addItem(menuItem("Settings…", action: #selector(openSettings)))
        menu.addItem(menuItem("Quit Potluck Monitor", action: #selector(quitApp)))
        item.menu = menu
        button.performClick(nil)
        item.menu = nil
    }

    private func menuItem(_ title: String, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func openApp() { emit("open") }
    @objc private func refresh() { emit("refresh") }
    @objc private func openSettings() { emit("settings") }
    @objc private func quitApp() { emit("quit") }

    private func handleCommand(_ line: String) {
        if line == "test-click" {
            DispatchQueue.main.async { [weak self] in
                self?.statusItem?.button?.performClick(nil)
            }
            return
        }
        guard line.hasPrefix("title\t") else { return }
        let encoded = String(line.dropFirst(6))
        guard let data = Data(base64Encoded: encoded),
              let title = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.statusItem?.button?.title = title.isEmpty ? "" : " \(title)"
        }
    }

    private func emit(_ message: String) {
        FileHandle.standardOutput.write(Data("\(message)\n".utf8))
    }
}

let app = NSApplication.shared
let delegate = StatusItemDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
