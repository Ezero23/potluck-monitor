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
        let frame = sender.window?.frame ?? .zero
        // Electron's global coordinates start at the primary screen's top-left.
        // NSScreen.main follows focus; screens.first remains the primary screen.
        let top = (NSScreen.screens.first?.frame.maxY ?? 0) - frame.maxY
        let event = NSApp.currentEvent?.type == .rightMouseUp ? "menu" : "toggle"
        emit("\(event)\t\(Int(frame.minX))\t\(Int(top))\t\(Int(frame.width))\t\(Int(frame.height))")
    }

    private func handleCommand(_ line: String) {
        if line.hasPrefix("display\t") {
            guard let data = Data(base64Encoded: String(line.dropFirst(8))),
                  let display = try? JSONDecoder().decode(Display.self, from: data) else { return }
            DispatchQueue.main.async { [weak self] in
                guard let button = self?.statusItem?.button else { return }
                button.title = display.title.isEmpty ? "" : " \(display.title)"
                button.toolTip = display.tooltip
                if let data = Data(base64Encoded: display.image), let image = NSImage(data: data),
                   display.width.isFinite, display.height.isFinite,
                   display.width > 0, display.height > 0 {
                    image.size = NSSize(width: min(display.width, 1024), height: min(display.height, 64))
                    image.isTemplate = display.template
                    button.image = image
                }
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

private struct Display: Decodable {
    let title: String
    let tooltip: String
    let image: String
    let width: Double
    let height: Double
    let template: Bool
}

let app = NSApplication.shared
let delegate = StatusItemDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
