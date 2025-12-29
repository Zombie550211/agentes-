import re
import subprocess
import os

file_path = r'c:\Users\Zombie\Documents\dashboard\Costumer.html'

def check_syntax():
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find script tags
    # Handle scripts with attributes and multiline
    script_pattern = re.compile(r'<script[^>]*>(.*?)</script>', re.DOTALL | re.IGNORECASE)
    
    matches = list(script_pattern.finditer(content))
    print(f"Found {len(matches)} script tags.")

    for i, match in enumerate(matches):
        script_content = match.group(1)
        # Determine line number (approximate)
        line_num = content[:match.start()].count('\n') + 1
        
        temp_js = f'temp_script_{i}.js'
        with open(temp_js, 'w', encoding='utf-8') as f:
            f.write(script_content)
            
        try:
            # Check syntax using node
            result = subprocess.run(['node', '--check', temp_js], capture_output=True, text=True)
            if result.returncode != 0:
                print(f"❌ Syntax error in script starting at line {line_num}:")
                print(result.stderr)
            else:
                print(f"✅ Script at line {line_num} is OK.")
        except Exception as e:
            print(f"Error checking script at line {line_num}: {e}")
        finally:
            if os.path.exists(temp_js):
                os.remove(temp_js)

if __name__ == "__main__":
    check_syntax()
