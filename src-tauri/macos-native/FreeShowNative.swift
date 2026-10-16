import Foundation
import Security
import CryptoKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import AppKit

// ScreenCaptureKit and CGDisplayBounds share top-left display coordinates.
// NSScreen.frame uses AppKit coordinates and must not be compared directly.
func captureScale(_ frame: CGRect, displays: [(CGRect, CGFloat)]) -> CGFloat {
    displays.max { left, right in
        let a=left.0.intersection(frame), b=right.0.intersection(frame)
        return (a.isNull ? 0 : a.width*a.height) < (b.isNull ? 0 : b.width*b.height)
    }?.1 ?? 1
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
func key(_ account: String, create: Bool) throws -> SymmetricKey {
    let query: [CFString: Any] = [kSecClass:kSecClassGenericPassword, kSecAttrService:"org.freeshow.plus.credentials", kSecAttrAccount:account, kSecReturnData:true, kSecMatchLimit:kSecMatchLimitOne]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let bytes = result as? Data, bytes.count == 32 { return SymmetricKey(data:bytes) }
    guard status == errSecItemNotFound && create else { throw NSError(domain:"Keychain",code:Int(status),userInfo:[NSLocalizedDescriptionKey:"Credential encryption key unavailable (\(status))"]) }
    var bytes = Data(count:32)
    let randomStatus = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!) }
    guard randomStatus == errSecSuccess else { throw NSError(domain:"Keychain",code:Int(randomStatus)) }
    let item: [CFString:Any] = [kSecClass:kSecClassGenericPassword,kSecAttrService:"org.freeshow.plus.credentials",kSecAttrAccount:account,kSecValueData:bytes,kSecAttrAccessible:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let added = SecItemAdd(item as CFDictionary,nil)
    if added == errSecDuplicateItem { return try key(account,create:false) }
    guard added == errSecSuccess else { throw NSError(domain:"Keychain",code:Int(added)) }
    return SymmetricKey(data:bytes)
}
func protect(_ decrypt: Bool,_ account: String) throws {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 16*1024*1024 else { throw NSError(domain:"Credentials too large",code:1) }
    let secret = try key(account,create:!decrypt)
    let output: Data
    if decrypt { output = try AES.GCM.open(AES.GCM.SealedBox(combined:input),using:secret,authenticating:Data(account.utf8)) }
    else { output = try AES.GCM.seal(input,using:secret,authenticating:Data(account.utf8)).combined! }
    FileHandle.standardOutput.write(output)
}

final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let raw: Bool
    let once: Bool
    let context = CIContext(options:[.cacheIntermediates:false])
    init(raw: Bool,once: Bool) { self.raw=raw; self.once=once }
    func stream(_ stream: SCStream, didStopWithError error: Error) { fail(error.localizedDescription) }
    func stream(_ stream: SCStream,didOutputSampleBuffer sample: CMSampleBuffer,of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sample,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]],
            let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
            let buffer = sample.imageBuffer else { return }
        autoreleasepool {
            let width=CVPixelBufferGetWidth(buffer),height=CVPixelBufferGetHeight(buffer)
            var output=Data()
            if raw {
                CVPixelBufferLockBaseAddress(buffer,.readOnly)
                defer { CVPixelBufferUnlockBaseAddress(buffer,.readOnly) }
                guard let base=CVPixelBufferGetBaseAddress(buffer) else { return }
                let stride=CVPixelBufferGetBytesPerRow(buffer)
                var w=UInt32(width).littleEndian,h=UInt32(height).littleEndian
                withUnsafeBytes(of:&w){output.append(contentsOf:$0)}
                withUnsafeBytes(of:&h){output.append(contentsOf:$0)}
                for row in 0..<height { output.append(base.advanced(by:row*stride).assumingMemoryBound(to:UInt8.self),count:width*4) }
            } else {
                let image=CIImage(cvPixelBuffer:buffer)
                guard let jpeg=context.jpegRepresentation(of:image,colorSpace:CGColorSpaceCreateDeviceRGB(),options:[kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption:0.98]) else { return }
                output=jpeg
            }
            var length=UInt32(output.count).littleEndian
            withUnsafeBytes(of:&length){FileHandle.standardOutput.write(Data($0))}
            FileHandle.standardOutput.write(output)
            if once { exit(0) }
        }
    }
}
@main @MainActor struct Main {
    static func main() async {
        let args=CommandLine.arguments
        let parent=getppid()
        do {
            guard args.count>1 else { fail("Missing native operation") }
            if args[1] == "protect" || args[1] == "unprotect" {
                guard args.count==3 else { fail("Missing credential namespace") }
                try protect(args[1]=="unprotect",args[2]); return
            }
            if args[1] == "keychain-selftest" {
                let account="ci-"+UUID().uuidString
                defer { SecItemDelete([kSecClass:kSecClassGenericPassword,kSecAttrService:"org.freeshow.plus.credentials",kSecAttrAccount:account] as CFDictionary) }
                let first=try key(account,create:true),second=try key(account,create:false)
                let bytes=Data("isolated FreeShow keychain fixture".utf8)
                let sealed=try AES.GCM.seal(bytes,using:first,authenticating:Data(account.utf8))
                guard try AES.GCM.open(sealed,using:second,authenticating:Data(account.utf8))==bytes else { fail("Keychain encryption roundtrip failed") }
                do { _=try AES.GCM.open(sealed,using:second,authenticating:Data("wrong namespace".utf8));fail("Credential namespace authentication failed") } catch {}
                print("PASS isolated Keychain key creation, reload, encryption and authentication; fixture removed");return
            }
            if args[1] == "spell" {
                let bytes=FileHandle.standardInput.readDataToEndOfFile()
                guard bytes.count<=4096,let data=try JSONSerialization.jsonObject(with:bytes) as? [String:Any],let word=data["word"] as? String,!word.isEmpty,word.count<=256 else { fail("Invalid spelling word") }
                let requested=(data["language"] as? String ?? "en-US").replacingOccurrences(of:"-",with:"_")
                guard let language=NSSpellChecker.shared.availableLanguages.first(where:{$0==requested}) ?? NSSpellChecker.shared.availableLanguages.first(where:{$0.hasPrefix(String(requested.prefix(2)))}) else { print("{\"supported\":false,\"suggestions\":[]}");return }
                let checker=NSSpellChecker.shared
                if data["action"] as? String == "add" { checker.learnWord(word);print("null");return }
                let error=checker.checkSpelling(of:word,startingAt:0,language:language,wrap:false,inSpellDocumentWithTag:0,wordCount:nil)
                let guesses=error.location==NSNotFound ? [] : Array((checker.guesses(forWordRange:NSRange(location:0,length:word.utf16.count),in:word,language:language,inSpellDocumentWithTag:0) ?? []).prefix(8))
                FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["supported":true,"misspelled":error.location != NSNotFound,"suggestions":guesses]));return
            }
            if args[1] == "selftest" {
                let displays:[(CGRect,CGFloat)]=[(CGRect(x:0,y:0,width:1440,height:900),2),(CGRect(x:1440,y:-1080,width:1920,height:1080),1)]
                guard captureScale(CGRect(x:1500,y:-900,width:800,height:600),displays:displays)==1,
                      captureScale(CGRect(x:100,y:100,width:800,height:600),displays:displays)==2,
                      captureScale(CGRect(x:1300,y:-100,width:800,height:600),displays:displays)==2 else { fail("Mixed-display capture scaling failed") }
                let secret=SymmetricKey(size:.bits256),data=Data("FreeShow+ native smoke".utf8)
                let box=try AES.GCM.seal(data,using:secret)
                guard try AES.GCM.open(box,using:secret)==data else { fail("AES test failed") }
                print("FreeShow+ native helper: AES-GCM and mixed-display capture geometry passed; ScreenCaptureKit linked");return
            }
            let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:false)
            if args[1] == "sources" {
                var sources:[[String:String]]=[]
                for (i,display) in content.displays.enumerated() { sources.append(["id":"native-screen-\(display.displayID)","name":"Entire screen \(i+1)","kind":"screen"]) }
                for window in content.windows {
                    guard let title=window.title,!title.isEmpty,!title.hasPrefix("FreeShow Output —") else { continue }
                    sources.append(["id":"native-window-\(window.windowID)","name":title,"kind":"window"])
                }
                FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:sources));return
            }
            guard args.count>=3 else { fail("Missing capture source") }
            let id=args[2],config=SCStreamConfiguration()
            let filter:SCContentFilter
            if id.hasPrefix("native-screen-"),let number=UInt32(id.dropFirst(14)),let display=content.displays.first(where:{$0.displayID==number}) {
                filter=SCContentFilter(display:display,excludingWindows:[])
                config.width=CGDisplayPixelsWide(display.displayID);config.height=CGDisplayPixelsHigh(display.displayID)
            } else if id.hasPrefix("native-window-"),let number=UInt32(id.dropFirst(14)),let window=content.windows.first(where:{$0.windowID==number}) {
                filter=SCContentFilter(desktopIndependentWindow:window)
                if #available(macOS 14.0, *) {
                    config.width=Int((filter.contentRect.width*CGFloat(filter.pointPixelScale)).rounded(.up))
                    config.height=Int((filter.contentRect.height*CGFloat(filter.pointPixelScale)).rounded(.up))
                } else {
                    let displays=content.displays.map { display -> (CGRect,CGFloat) in
                        let bounds=CGDisplayBounds(display.displayID)
                        let scale=bounds.width>0 ? CGFloat(CGDisplayPixelsWide(display.displayID))/bounds.width : 1
                        return (bounds,scale)
                    }
                    let scale=captureScale(window.frame,displays:displays)
                    config.width=Int((window.frame.width*scale).rounded(.up));config.height=Int((window.frame.height*scale).rounded(.up))
                }
            } else { fail("Capture source closed. Refresh the source list.") }
            guard config.width>0,config.height>0,config.width<=8192,config.height<=8192 else { fail("Invalid capture dimensions") }
            config.pixelFormat=kCVPixelFormatType_32BGRA;config.showsCursor=false;config.queueDepth=3
            config.minimumFrameInterval=CMTime(value:1,timescale:30)
            let capture=Capture(raw:args[1]=="raw",once:args[1]=="snapshot")
            let stream=SCStream(filter:filter,configuration:config,delegate:capture)
            try stream.addStreamOutput(capture,type:.screen,sampleHandlerQueue:DispatchQueue(label:"org.freeshow.capture"))
            try await stream.startCapture()
            Task { @MainActor in
                do { for try await line in FileHandle.standardInput.bytes.lines {
                    if let fps=Int32(line),fps>=1,fps<=60 {
                        config.minimumFrameInterval=CMTime(value:1,timescale:fps)
                        try await stream.updateConfiguration(config)
                    }
                }} catch {}
            }
            while getppid()==parent { try await Task.sleep(nanoseconds:1_000_000_000) }
            try await stream.stopCapture()
        } catch { fail(error.localizedDescription) }
    }
}
