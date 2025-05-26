# A browser-based VNC client for XR headsets based on noVNC

The idea is to create a quicker-and-dirty XR desktop client proof of concept. The goal is to get it running on Android with Termux (or the new Android 16 AVM/pKVM Terminal) and a VNC server to have a reasonable VR/XR Linux system in your pocket.

An Android app is work-in-prorgress, the current app is using Viture XR glasses and Viture SDK to auto-pan the workspace.

# Pre-requisites

* VNC server with Websockets support
  * QEmu is supposed to work out-of-the-box afaict, 
  * I used TightVNC (TigerVNC should work as well), but it needs a TCP/Websocket bridge server like [WSTCP](https://github.com/sile/wstcp) or Websocketify.

# Trying it

* Macos:
  * `python3 -m http.server 8080 --bind 127.0.0.1 --directory .`
  * set up your VNC, run it and run the TCP/Websocket bridge if needed - I used a resolution of 3840x1080 to have a nice large workspace without having to use virtual desktops,
  * Open `http://localhost:8080/index_B.html` and connect to your VNC server.
