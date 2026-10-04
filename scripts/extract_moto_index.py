import json
import re

FILES = [
    {
        "name": "Exiv_250_owner_manual.pdf",
        "txt": "/tmp/motorcycle_manuals/owner.txt",
        "title": "Exiv 250 Owner Manual"
    },
    {
        "name": "Exiv250_service_manual_english.pdf",
        "txt": "/tmp/motorcycle_manuals/service.txt",
        "title": "Exiv 250 Service Manual"
    }
]

# Action taxonomies mapped to zones and their identifying keywords
TAXONOMY = {
    "brake pads": {
        "Brake-pad inspection / replacement": {
            "desc": "Inspect brake pad wear and replace pads if they are below the service limit.",
            "kws": ["brake pad", "pad wear", "replace pad"]
        },
        "Brake-fluid replacement and bleeding": {
            "desc": "Check brake fluid levels, bleed air from the lines, and replace fluid.",
            "kws": ["brake fluid", "bleed", "reservoir"]
        },
        "Front caliper removal / installation": {
            "desc": "Procedures for detaching and reattaching the front brake caliper assembly.",
            "kws": ["front caliper", "caliper mount"]
        },
        "Rear caliper removal / installation": {
            "desc": "Procedures for detaching and reattaching the rear brake caliper assembly.",
            "kws": ["rear caliper", "caliper mount"]
        }
    },
    "oil/engine": {
        "Checking / changing engine oil": {
            "desc": "Verify engine oil levels and perform a complete oil change.",
            "kws": ["oil level", "oil change", "drain plug", "engine oil"]
        },
        "Oil-filter service": {
            "desc": "Locate and replace the engine oil filter element.",
            "kws": ["oil filter", "filter element"]
        }
    },
    "chain": {
        "Drive-chain slack adjustment": {
            "desc": "Measure and adjust the tension or slack of the drive chain.",
            "kws": ["chain slack", "chain tension", "adjust chain"]
        },
        "Drive-chain lubrication and cleaning": {
            "desc": "Clean and apply lubricant to the drive chain.",
            "kws": ["lubricat", "clean chain", "chain lube"]
        }
    },
    "tires/wheels": {
        "Tire pressure and tread inspection": {
            "desc": "Check for correct tire pressure and measure tread depth.",
            "kws": ["tire pressure", "tread depth", "tire wear"]
        },
        "Wheel removal / installation": {
            "desc": "Steps to safely remove and install front or rear wheels.",
            "kws": ["front wheel", "rear wheel", "axle"]
        }
    },
    "battery/electrical": {
        "Battery removal and charging": {
            "desc": "Disconnect, remove, and charge the motorcycle battery safely.",
            "kws": ["battery terminal", "charge battery", "remove battery"]
        },
        "Fuse replacement": {
            "desc": "Locate the fuse box and replace blown fuses.",
            "kws": ["fuse box", "blown fuse", "replace fuse"]
        }
    },
    "lights": {
        "Headlight aiming and bulb replacement": {
            "desc": "Adjust headlight beam and replace the main headlight bulb.",
            "kws": ["headlight bulb", "headlight aim", "beam"]
        },
        "Turn signal / taillight service": {
            "desc": "Check and replace bulbs for turn signals and brake/taillight.",
            "kws": ["turn signal", "taillight", "tail light", "signal bulb"]
        }
    },
    "controls": {
        "Clutch lever adjustment": {
            "desc": "Adjust clutch lever free play for proper engagement.",
            "kws": ["clutch lever", "clutch play", "clutch cable"]
        },
        "Throttle cable play adjustment": {
            "desc": "Ensure the throttle grip operates smoothly and adjust free play.",
            "kws": ["throttle cable", "throttle grip", "throttle play"]
        }
    }
}

actions_found = []

for f_info in FILES:
    try:
        with open(f_info["txt"], "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception as e:
        print(f"Failed to read {f_info['txt']}: {e}")
        continue
    
    pages = content.split('\x0c')
    for page_idx, page_text in enumerate(pages):
        page_num = page_idx + 1
        lines = page_text.split('\n')
        
        paragraphs = []
        current_para = []
        for line in lines:
            line_s = line.strip()
            if not line_s:
                if current_para:
                    paragraphs.append(" ".join(current_para))
                    current_para = []
            else:
                current_para.append(line_s)
        if current_para:
            paragraphs.append(" ".join(current_para))
            
        for para in paragraphs:
            para_lower = para.lower()
            if len(para) < 40 or len(para) > 800:
                continue
                
            # Skip TOC or weird formatting
            if "......" in para or "____" in para:
                continue

            for zone, actions in TAXONOMY.items():
                for action_title, action_info in actions.items():
                    if any(kw in para_lower for kw in action_info["kws"]):
                        # add to results
                        actions_found.append({
                            "zone": zone,
                            "actionTitle": action_title,
                            "description": action_info["desc"],
                            "document": f_info["title"],
                            "filename": f_info["name"],
                            "page": page_num,
                            "excerpt": para
                        })

# Consolidate by action
consolidated_actions = {}

for r in actions_found:
    key = r["actionTitle"]
    if key not in consolidated_actions:
        consolidated_actions[key] = {
            "zone": r["zone"],
            "actionTitle": r["actionTitle"],
            "description": r["description"],
            "sources": []
        }
    
    # Check for duplicates in excerpts
    text_key = r["excerpt"][:50].lower()
    existing = [s["excerpt"][:50].lower() for s in consolidated_actions[key]["sources"]]
    if text_key not in existing:
        consolidated_actions[key]["sources"].append({
            "document": r["document"],
            "filename": r["filename"],
            "page": r["page"],
            "excerpt": r["excerpt"]
        })

# Keep top 3 best sources per action (e.g. ones with numbers/specs)
final_actions = []
for action_info in consolidated_actions.values():
    sources = action_info["sources"]
    sources.sort(key=lambda x: len(re.findall(r'\d+', x["excerpt"])), reverse=True)
    action_info["sources"] = sources[:3]
    final_actions.append(action_info)

out_data = {
    "_note": "Generated from Aaryan's Nextcloud files",
    "actions": final_actions
}

with open("/home/Aarz/agent-dashboard/motorcycle_index.json", "w") as f:
    json.dump(out_data, f, indent=2)

print(f"Generated index with {len(final_actions)} actions.")
for a in final_actions:
    print(f"  - {a['actionTitle']} ({len(a['sources'])} sources)")

