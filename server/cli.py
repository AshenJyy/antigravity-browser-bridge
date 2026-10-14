#!/usr/bin/env python3
"""
Antigravity Browser Bridge - CLI Tool
Allows sending commands to your real Chrome browser directly from terminal / Agent.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import urllib.error

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_BASE = "http://127.0.0.1:9224"


def ensure_server_running():
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                return True
    except Exception:
        pass

    print("[Bridge CLI] Server not active, auto-starting background daemon...")
    server_dir = Path(__file__).resolve().parent
    server_py = server_dir / "server.py"
    
    DETACHED = 0x00000008 | 0x08000000
    for cmd in ["pythonw", "py", "python"]:
        try:
            subprocess.Popen(
                [cmd, str(server_py)],
                cwd=str(server_dir),
                creationflags=DETACHED if sys.platform == "win32" else 0,
                close_fds=True
            )
            break
        except Exception:
            continue

    for _ in range(10):
        time.sleep(0.3)
        try:
            with urllib.request.urlopen(f"{API_BASE}/health", timeout=1) as resp:
                if json.loads(resp.read().decode("utf-8")).get("ok"):
                    print("[Bridge CLI] Server started successfully!")
                    return True
        except Exception:
            pass
    return False


def api_request(path: str, data: dict = None, method: str = None) -> dict:
    url = f"{API_BASE}{path}"
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        if not method:
            method = "POST"
    elif not method:
        method = "GET"

    req = urllib.request.Request(
        url,
        data=req_data,
        headers={"Content-Type": "application/json"} if req_data else {},
        method=method
    )

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return json.loads(err_body)
        except Exception:
            return {"success": False, "error": f"HTTP {e.code}: {err_body}"}
    except urllib.error.URLError as e:
        # Try auto-launching server once
        if ensure_server_running():
            try:
                with urllib.request.urlopen(req, timeout=25) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception as retry_err:
                print(f"Error connecting to Bridge Server ({url}): {retry_err}")
                sys.exit(1)
        else:
            server_py_str = str(Path(__file__).resolve().parent / "server.py")
            print(f"Error connecting to Bridge Server ({url}): {e}")
            print(f"Tip: Make sure the server at '{server_py_str}' is running!")
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Antigravity Browser Bridge CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # status
    subparsers.add_parser("status", help="Check server & extension connection status")

    # tabs
    subparsers.add_parser("tabs", help="List all open browser tabs")

    # active
    subparsers.add_parser("active", help="Get currently focused browser tab")

    # open
    p_open = subparsers.add_parser("open", help="Open a new tab with URL")
    p_open.add_argument("url", help="URL to open")

    # goto / navigate
    p_goto = subparsers.add_parser("goto", help="Navigate tab to a URL")
    p_goto.add_argument("url", help="URL to navigate to")
    p_goto.add_argument("--tab", type=int, help="Target tab ID (defaults to active tab)")

    # eval
    p_eval = subparsers.add_parser("eval", help="Evaluate JavaScript expression on tab")
    p_eval.add_argument("code", help="JavaScript code to execute")
    p_eval.add_argument("--tab", type=int, help="Target tab ID")

    # snap / snapshot
    p_snap = subparsers.add_parser("snap", help="Fast token-efficient snapshot of interactive elements (#1, #2...)")
    p_snap.add_argument("--tab", type=int, help="Target tab ID")

    # click
    p_click = subparsers.add_parser("click", help="Smart click by index (#1 or 1), text ('Star'), or selector")
    p_click.add_argument("selector", help="Target: index (#1 or 1), text ('Star'), or CSS selector")
    p_click.add_argument("--tab", type=int, help="Target tab ID")

    # type
    p_type = subparsers.add_parser("type", help="Smart type into input by index (#1), placeholder, or selector")
    p_type.add_argument("selector", help="Target input: index (#1 or 1), placeholder, or CSS selector")
    p_type.add_argument("text", help="Text to input")
    p_type.add_argument("--tab", type=int, help="Target tab ID")
    p_type.add_argument("--append", action="store_true", help="Don't clear input before typing")

    # text
    p_text = subparsers.add_parser("text", help="Extract text content from page")
    p_text.add_argument("--tab", type=int, help="Target tab ID")

    # screenshot
    p_shot = subparsers.add_parser("screenshot", help="Capture screenshot of tab")
    p_shot.add_argument("output", nargs="?", default="screenshot.png", help="File path to save screenshot (e.g. shot.png)")
    p_shot.add_argument("--tab", type=int, help="Target tab ID")

    # group / native tab group
    p_group = subparsers.add_parser("group", help="Add tab into native browser 'Gemini' Tab Group")
    p_group.add_argument("--tab", type=int, help="Target tab ID")

    # reload
    subparsers.add_parser("reload", help="Reload the Chrome/Edge extension")

    # cdp
    p_cdp = subparsers.add_parser("cdp", help="Send arbitrary Chrome DevTools Protocol (CDP) method")
    p_cdp.add_argument("method", help="CDP method (e.g. Runtime.evaluate, Page.navigate)")
    p_cdp.add_argument("params", nargs="?", default="{}", help="JSON params for CDP method")
    p_cdp.add_argument("--tab", type=int, help="Target tab ID")

    # close
    p_close = subparsers.add_parser("close", help="Close a tab")
    p_close.add_argument("--tab", type=int, required=True, help="Tab ID to close")

    # ungroup
    p_ungroup = subparsers.add_parser("ungroup", help="Disband Gemini tab group or ungroup tab")
    p_ungroup.add_argument("--tab", type=int, help="Target tab ID (optional)")

    args = parser.parse_args()

    if args.command == "status":
        res = api_request("/health")
        connected = res.get("extension_connected", False)
        print("Bridge Server:       🟢 Running")
        if connected:
            browsers = res.get("browsers", [])
            pref = res.get("preferred", "")
            if browsers:
                b_desc = ", ".join([f"{b.get('browser')} (v{b.get('version')})" for b in browsers])
                print(f"Connected Browsers:  🟢 {b_desc}")
                print(f"Preferred Browser:   {pref}")
            else:
                print("Browser Extension:   🟢 Connected")
        else:
            print("Browser Extension:   🔴 Disconnected (Check Edge or Chrome)")

    elif args.command == "tabs":
        res = api_request("/tabs")
        if not res.get("success"):
            print(f"Failed to list tabs: {res.get('error')}")
            return
        tabs = res.get("data", [])
        print(f"Open Tabs ({len(tabs)}):")
        for t in tabs:
            active_marker = " [*]" if t.get("active") else "    "
            attached_marker = " [Attached]" if t.get("attached") else ""
            b_name = t.get("browser", "")
            b_tag = f"[{b_name.replace('Microsoft ', '').replace('Google ', '')}] " if b_name else ""
            g_tag = f"[{t.get('groupTitle')}] " if t.get("groupTitle") else ""
            title = (t.get("title") or "")[:35]
            url = (t.get("url") or "")[:55]
            print(f"{active_marker} ID: {t.get('id'):<6} {b_tag}{g_tag}{title:<37} ({url}){attached_marker}")

    elif args.command == "active":
        res = api_request("/active_tab")
        if res.get("success"):
            tab = res.get("data", {})
            print(f"Active Tab ID: {tab.get('id')}")
            print(f"Title:         {tab.get('title')}")
            print(f"URL:           {tab.get('url')}")
            print(f"Attached:      {tab.get('attached')}")
        else:
            print(f"Error: {res.get('error')}")

    elif args.command == "open":
        res = api_request("/new_tab", {"url": args.url})
        if res.get("success"):
            print(f"Opened tab ID {res.get('data', {}).get('id')} -> {args.url}")
        else:
            print(f"Error: {res.get('error')}")

    elif args.command == "goto":
        payload = {"url": args.url}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/navigate", payload)
        if res.get("success"):
            print(f"Navigated to {args.url}")
        else:
            print(f"Error: {res.get('error')}")

    elif args.command == "snap":
        payload = {}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/snap", payload)
        if res.get("success"):
            data = res.get("data", {})
            print(f"=== {data.get('title')} ({data.get('count')} elements) ===")
            print(data.get("elements", ""))
        else:
            print(f"Snap Error: {res.get('error')}")

    elif args.command == "reload":
        res = api_request("/reload", {})
        print("Reload signal sent to extension.")

    elif args.command in ("group", "tag"):
        payload = {}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/group", payload)
        if res.get("success"):
            print("Tab added to native browser [Gemini] Tab Group! 🗂️")
        else:
            print(f"Group Error: {res.get('error')}")

    elif args.command == "ungroup":
        payload = {}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/ungroup", payload)
        if res.get("success"):
            print("Tab ungrouped / Gemini group disbanded.")
        else:
            print(f"Ungroup Error: {res.get('error')}")

    elif args.command == "eval":
        payload = {"expression": args.code}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/eval", payload)
        if res.get("success"):
            print(json.dumps(res.get("data"), ensure_ascii=False, indent=2))
        else:
            print(f"Eval Error: {res.get('error')}")

    elif args.command == "click":
        payload = {"selector": args.selector}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/click", payload)
        if res.get("success"):
            print(f"Clicked: {res.get('data')}")
        else:
            print(f"Click Error: {res.get('error')}")

    elif args.command == "type":
        payload = {"selector": args.selector, "text": args.text, "clear": not args.append}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/type", payload)
        if res.get("success"):
            print(f"Typed text: {res.get('data')}")
        else:
            print(f"Type Error: {res.get('error')}")

    elif args.command == "text":
        payload = {}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/content", payload)
        if res.get("success"):
            data = res.get("data", {})
            print(f"=== {data.get('title')} ({data.get('url')}) ===")
            print(data.get("text", "")[:2000])
        else:
            print(f"Error: {res.get('error')}")

    elif args.command == "screenshot":
        payload = {"output": args.output}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/screenshot", payload)
        if res.get("success"):
            print(f"Screenshot saved to: {res.get('saved_to', args.output)}")
        else:
            print(f"Screenshot Error: {res.get('error')}")

    elif args.command == "cdp":
        try:
            params_dict = json.loads(args.params)
        except Exception:
            params_dict = {}
        payload = {"method": args.method, "params": params_dict}
        if args.tab:
            payload["tabId"] = args.tab
        res = api_request("/cdp", payload)
        if res.get("success"):
            print(json.dumps(res.get("data"), ensure_ascii=False, indent=2))
        else:
            print(f"CDP Error: {res.get('error')}")

    elif args.command == "close":
        res = api_request("/close_tab", {"tabId": args.tab})
        if res.get("success"):
            print(f"Closed tab {args.tab}")
        else:
            print(f"Error: {res.get('error')}")


if __name__ == "__main__":
    main()
