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

ZONES = {
    "brake pads": ["brake pad", "brake caliper", "braking", "brake fluid"],
    "oil/engine": ["engine oil", "oil change", "oil filter", "lubrication"],
    "chain": ["drive chain", "chain slack", "chain tension", "lubricating chain"],
    "tires/wheels": ["tire pressure", "tires", "wheel", "tread depth"],
    "battery/electrical": ["battery", "fuse", "electrical", "voltage"],
    "lights": ["headlight", "turn signal", "taillight", "bulb"],
    "controls": ["clutch lever", "throttle", "brake lever", "steering"]
}

results = []

for f_info in FILES:
    with open(f_info["txt"], "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    
    pages = content.split('\x0c')
    for page_idx, page_text in enumerate(pages):
        page_num = page_idx + 1
        lines = page_text.split('\n')
        
        # very basic paragraph extraction (blocks separated by empty lines)
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
            matched_zones = []
            for zone, keywords in ZONES.items():
                if any(kw in para_lower for kw in keywords):
                    matched_zones.append(zone)
            
            if matched_zones:
                # To prevent too much garbage, only keep paras that are 50 to 500 chars
                # and contain some numbers (specs) or useful words.
                if 40 <= len(para) <= 600:
                    for zone in matched_zones:
                        results.append({
                            "zone": zone,
                            "document": f_info["title"],
                            "filename": f_info["name"],
                            "page": page_num,
                            "excerpt": para
                        })

# Now we consolidate them. We don't need all results, just the best ones for each zone.
# We'll pick max 5 per zone to keep the index small.
consolidated = []
for zone in ZONES.keys():
    zone_results = [r for r in results if r["zone"] == zone]
    
    # Sort by how "dense" they are with keywords? Or just pick first few.
    # We prefer excerpts with numbers (often specs)
    zone_results.sort(key=lambda x: len(re.findall(r'\d+', x["excerpt"])), reverse=True)
    
    # Take top 5 distinct excerpts
    seen = set()
    added = 0
    for r in zone_results:
        # filter out table of contents garbage
        if "......" in r["excerpt"] or "____" in r["excerpt"]: continue
        if len(r["excerpt"]) < 60: continue
        
        # fuzzy dedupe
        text_key = r["excerpt"][:50].lower()
        if text_key not in seen:
            seen.add(text_key)
            consolidated.append(r)
            added += 1
        if added >= 6:
            break

out_data = {
    "_note": "Generated from Aaryan's Nextcloud files",
    "zones": ZONES,
    "index": consolidated
}

with open("/home/Aarz/agent-dashboard/motorcycle_index.json", "w") as f:
    json.dump(out_data, f, indent=2)

print(f"Generated index with {len(consolidated)} entries.")
