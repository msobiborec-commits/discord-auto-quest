"""
Discord Quest Auto-Completer - Vencord One-Click Button Installer
Injects an '⚡ Auto-Complete Quests' button directly into Vencord's Quick Actions menu.
"""

import os
import shutil
import sys

def install():
    appdata = os.getenv("APPDATA")
    if not appdata:
        print("[-] Could not determine %APPDATA% directory.")
        return False

    vencord_renderer = os.path.join(appdata, "Vencord", "dist", "renderer.js")
    if not os.path.exists(vencord_renderer):
        print(f"[-] Vencord renderer not found at: {vencord_renderer}")
        print("    Please ensure Vencord is installed.")
        return False

    backup_file = vencord_renderer + ".bak"
    if os.path.exists(backup_file):
        shutil.copy2(backup_file, vencord_renderer)
        print("[+] Restored original clean renderer.js from backup.")
    else:
        shutil.copy2(vencord_renderer, backup_file)
        print(f"[+] Backup created at {backup_file}")

    with open(vencord_renderer, "r", encoding="utf-8") as f:
        content = f.read()

    target = 'r(ru,null,r(vr,{Icon:n0,text:"Notification Log",action:Ma}),'
    replacement = 'r(ru,null,r(vr,{Icon:ts,text:"⚡ Auto-Complete Quests",action:()=>{if(window.__runDiscordQuestCompleter)window.__runDiscordQuestCompleter();}}),r(vr,{Icon:n0,text:"Notification Log",action:Ma}),'

    if target not in content:
        print("[-] Target injection anchor not found in renderer.js.")
        return False

    content = content.replace(target, replacement, 1)

    # Read quest_completer.js code
    script_path = os.path.join(os.path.dirname(__file__), "quest_completer.js")
    if not os.path.exists(script_path):
        print("[-] quest_completer.js not found in current directory.")
        return False

    with open(script_path, "r", encoding="utf-8") as f:
        script_code = f.read()

    # Wrap into window.__runDiscordQuestCompleter
    engine_code = "\n;window.__runDiscordQuestCompleter = async function() {\n" + script_code + "\n};\n"
    content = content + "\n" + engine_code

    with open(vencord_renderer, "w", encoding="utf-8") as f:
        f.write(content)

    print("[+] Successfully installed '⚡ Auto-Complete Quests' button into Vencord!")
    print("[*] Please reload Discord (Ctrl + R or click 'Relaunch Discord') to see the button.")
    return True

if __name__ == "__main__":
    install()
