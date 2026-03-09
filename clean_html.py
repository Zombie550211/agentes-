#!/usr/bin/env python3
import re

# Read original file
with open('frontend/Costumer.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract HEAD section (up to first <body>)
head_end = content.find('<body>')
head_section = content[:head_end] if head_end != -1 else content

# Remove all <style>...</style> blocks from HEAD
head_clean = re.sub(r'<style[^>]*>.*?</style>', '', head_section, flags=re.DOTALL | re.IGNORECASE)

# Extract all <script>...</script> blocks (INCLUDING FROM BODY)
script_pattern = r'<script[^>]*>.*?</script>'
scripts = re.findall(script_pattern, content, flags=re.DOTALL | re.IGNORECASE)

# Build clean file
clean_content = head_clean.strip()

# Ensure HEAD is closed
if not clean_content.endswith('</head>'):
    clean_content += '\n</head>\n'

# Add empty body
clean_content += '<body>\n'

# Add all scripts
for script in scripts:
    clean_content += script + '\n'

# Close body and html
clean_content += '</body>\n</html>\n'

# Write clean file
with open('frontend/Costumer.html', 'w', encoding='utf-8') as f:
    f.write(clean_content)

print(f"✅ File cleaned successfully!")
print(f"   Scripts found: {len(scripts)}")
print(f"   Total lines: {len(clean_content.splitlines())}")
print(f"   File size: {len(clean_content)} chars")
