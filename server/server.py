#!/usr/bin/env python3
"""
Antigravity Browser Bridge - Local Server
Hosts a WebSocket server for the Chrome extension and an HTTP API for Antigravity/CLI.
"""

import asyncio
import base64
import json
import os
import sys
from typing import Dict, Any, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import websockets
except ImportError:
    print("Error: 'websockets' package is required. Install it using: py -m pip install websockets")
    sys.exit(1)

WS_HOST = "127.0.0.1"
WS_PORT = 9223

HTTP_HOST = "127.0.0.1"
HTTP_PORT = 9224

connected_browsers: Dict[str, Dict[str, Any]] = {}
tab_to_browser: Dict[int, str] = {}
preferred_browser: str = "Microsoft Edge"
pending_requests: Dict[int, asyncio.Future] = {}
req_counter = 0


def get_next_id() -> int:
    global req_counter
    req_counter += 1
    return req_counter


def get_target_ws(tab_id: Optional[int] = None, target_browser: Optional[str] = None) -> Optional[Any]:
    if target_browser and target_browser in connected_browsers:
        ws = connected_browsers[target_browser]["ws"]
        if ws and not getattr(ws, "closed", False):
            return ws
    if tab_id is not None and tab_id in tab_to_browser:
        b_name = tab_to_browser[tab_id]
        if b_name in connected_browsers:
            ws = connected_browsers[b_name]["ws"]
            if ws and not getattr(ws, "closed", False):
                return ws
    for b_name in (preferred_browser, "Microsoft Edge", "Google Chrome"):
        if b_name in connected_browsers:
            ws = connected_browsers[b_name]["ws"]
            if ws and not getattr(ws, "closed", False):
                return ws
    for b_name, b_data in connected_browsers.items():
        ws = b_data["ws"]
        if ws and not getattr(ws, "closed", False):
            return ws
    return None


async def send_command_raw(ws: Any, action: str, tab_id: Optional[int] = None, **kwargs) -> Dict[str, Any]:
    req_id = get_next_id()
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    payload = {
        "type": "request",
        "id": req_id,
        "action": action,
        "tabId": tab_id,
        **kwargs
    }

    try:
        await ws.send(json.dumps(payload))
        res = await asyncio.wait_for(future, timeout=20.0)
        return res
    except asyncio.TimeoutError:
        return {"success": False, "error": f"Command '{action}' timed out after 20s"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        pending_requests.pop(req_id, None)


async def send_command(action: str, tab_id: Optional[int] = None, target_browser: Optional[str] = None, **kwargs) -> Dict[str, Any]:
    if action == "list_tabs" and not target_browser:
        if not connected_browsers:
            return {"success": False, "error": "No browser extension is currently connected."}
        all_tabs = []
        for b_name, b_data in list(connected_browsers.items()):
            b_ws = b_data["ws"]
            if b_ws and not getattr(b_ws, "closed", False):
                sub_res = await send_command_raw(b_ws, "list_tabs")
                if sub_res.get("success") and isinstance(sub_res.get("data"), list):
                    for tab in sub_res["data"]:
                        tab["browser"] = b_name
                        tab_to_browser[tab["id"]] = b_name
                        all_tabs.append(tab)
        return {"success": True, "data": all_tabs}

    ws = get_target_ws(tab_id, target_browser)
    if not ws:
        return {
            "success": False,
            "error": "Browser extension is not connected. Please make sure Edge or Chrome is running with Antigravity Browser Bridge extension loaded."
        }

    if tab_id is None and action not in ("list_tabs", "get_active_tab", "create_tab"):
        active_tab_res = await send_command_raw(ws, "get_active_tab")
        if active_tab_res.get("success") and active_tab_res.get("data"):
            tab_id = active_tab_res["data"]["id"]
        else:
            return {"success": False, "error": "Could not determine active tab ID"}

    return await send_command_raw(ws, action, tab_id=tab_id, **kwargs)


async def handle_ws(websocket):
    current_browser = "Unknown Browser"
    print(f"[Bridge WS] Extension connected from {websocket.remote_address}")

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                elif msg_type == "response":
                    req_id = data.get("id")
                    if req_id in pending_requests:
                        future = pending_requests[req_id]
                        if not future.done():
                            future.set_result(data)
                elif msg_type == "cdp_event":
                    pass
                elif msg_type == "tab_detached":
                    print(f"[Bridge WS] Tab {data.get('tabId')} detached: {data.get('reason')}")
                elif msg_type == "client_hello":
                    current_browser = data.get("client", "Unknown Browser")
                    c_info = {
                        "browser": current_browser,
                        "browser_version": data.get("browserVersion", ""),
                        "version": data.get("version", "1.0.0")
                    }
                    connected_browsers[current_browser] = {
                        "ws": websocket,
                        "info": c_info
                    }
                    print(f"[Bridge WS] Client registered: {c_info['browser']} (v{c_info['browser_version']}, ext v{c_info['version']})")
            except Exception as e:
                print(f"[Bridge WS] Error parsing message: {e}")
    except Exception as e:
        print(f"[Bridge WS] Connection closed: {e}")
    finally:
        if current_browser in connected_browsers and connected_browsers[current_browser]["ws"] == websocket:
            del connected_browsers[current_browser]
            print(f"[Bridge WS] {current_browser} disconnected.")


async def handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        line = await reader.readline()
        if not line:
            writer.close()
            return

        parts = line.decode("utf-8", errors="ignore").strip().split()
        if len(parts) < 2:
            writer.close()
            return
        method, path = parts[0].upper(), parts[1]

        headers = {}
        while True:
            header_line = await reader.readline()
            if not header_line or header_line in (b"\r\n", b"\n"):
                break
            h_str = header_line.decode("utf-8", errors="ignore").strip()
            if ":" in h_str:
                k, v = h_str.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        content_length = int(headers.get("content-length", 0))
        body_bytes = b""
        if content_length > 0:
            body_bytes = await reader.readexactly(content_length)

        body_json = {}
        if body_bytes:
            try:
                body_json = json.loads(body_bytes.decode("utf-8"))
            except Exception:
                pass

        # CORS headers for easy development/testing
        cors_headers = (
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Access-Control-Allow-Headers: Content-Type\r\n"
        )

        if method == "OPTIONS":
            writer.write(f"HTTP/1.1 204 No Content\r\n{cors_headers}\r\n".encode())
            await writer.drain()
            writer.close()
            return

        response_data: Dict[str, Any] = {}

        if method == "GET" and path == "/health":
            response_data = {
                "ok": True,
                "extension_connected": len(connected_browsers) > 0,
                "browsers": [b["info"] for b in connected_browsers.values()],
                "preferred": preferred_browser
            }
        elif method == "GET" and path == "/tabs":
            response_data = await send_command("list_tabs")
        elif method == "GET" and path == "/active_tab":
            response_data = await send_command("get_active_tab")
        elif path == "/snap":
            response_data = await send_command("snapshot", tab_id=body_json.get("tabId"))
        elif path in ("/group", "/tag"):
            response_data = await send_command("group", tab_id=body_json.get("tabId"))
        elif path in ("/ungroup", "/close_group"):
            response_data = await send_command("ungroup", tab_id=body_json.get("tabId"))
        elif method == "POST" and path == "/reload":
            response_data = await send_command("reload_ext")
        elif method == "POST" and path == "/attach":
            response_data = await send_command("attach", tab_id=body_json.get("tabId"))
        elif method == "POST" and path == "/detach":
            response_data = await send_command("detach", tab_id=body_json.get("tabId"))
        elif method == "POST" and path == "/navigate":
            response_data = await send_command("navigate", tab_id=body_json.get("tabId"), url=body_json.get("url"))
        elif method == "POST" and path == "/new_tab":
            response_data = await send_command("create_tab", url=body_json.get("url"), active=body_json.get("active", True))
        elif method == "POST" and path == "/close_tab":
            response_data = await send_command("close_tab", tab_id=body_json.get("tabId"))
        elif method == "POST" and path == "/eval":
            response_data = await send_command(
                "eval",
                tab_id=body_json.get("tabId"),
                expression=body_json.get("expression") or body_json.get("code")
            )
        elif method == "POST" and path == "/click":
            response_data = await send_command(
                "click",
                tab_id=body_json.get("tabId"),
                selector=body_json.get("selector")
            )
        elif method == "POST" and path == "/type":
            response_data = await send_command(
                "type",
                tab_id=body_json.get("tabId"),
                selector=body_json.get("selector"),
                text=body_json.get("text", ""),
                clear=body_json.get("clear", True)
            )
        elif method == "POST" and path == "/content":
            response_data = await send_command("get_content", tab_id=body_json.get("tabId"))
        elif method == "POST" and path == "/screenshot":
            screenshot_res = await send_command("screenshot", tab_id=body_json.get("tabId"))
            if screenshot_res.get("success") and screenshot_res.get("data"):
                output_path = body_json.get("output")
                if output_path:
                    try:
                        img_data = base64.b64decode(screenshot_res["data"])
                        with open(output_path, "wb") as f:
                            f.write(img_data)
                        response_data = {"success": True, "saved_to": os.path.abspath(output_path)}
                    except Exception as e:
                        response_data = {"success": False, "error": f"Failed to save screenshot: {e}"}
                else:
                    response_data = screenshot_res
            else:
                response_data = screenshot_res
        elif method == "POST" and path == "/cdp":
            response_data = await send_command(
                "cdp",
                tab_id=body_json.get("tabId"),
                method=body_json.get("method"),
                params=body_json.get("params", {})
            )
        else:
            response_data = {"error": f"Route not found: {method} {path}"}

        resp_body = json.dumps(response_data, ensure_ascii=False).encode("utf-8")
        status_code = "200 OK" if "error" not in response_data or response_data.get("success") is True else "400 Bad Request"
        if "Route not found" in response_data.get("error", ""):
            status_code = "404 Not Found"

        response_str = (
            f"HTTP/1.1 {status_code}\r\n"
            f"Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(resp_body)}\r\n"
            f"{cors_headers}\r\n"
        )
        writer.write(response_str.encode() + resp_body)
        await writer.drain()
    except Exception as e:
        print(f"[Bridge HTTP] Error handling request: {e}")
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def main():
    print("=" * 60)
    print("  🚀 Antigravity Browser Bridge Server")
    print("=" * 60)
    print(f"[*] WebSocket server listening on: ws://{WS_HOST}:{WS_PORT}")
    print(f"[*] HTTP REST API listening on:    http://{HTTP_HOST}:{HTTP_PORT}")
    print("[*] Waiting for Chrome Extension connection...")
    print("=" * 60)

    ws_server = await websockets.serve(handle_ws, WS_HOST, WS_PORT)
    http_server = await asyncio.start_server(handle_http, HTTP_HOST, HTTP_PORT)

    async with ws_server, http_server:
        await asyncio.gather(
            ws_server.serve_forever(),
            http_server.serve_forever()
        )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Server stopped.")
