#            __                     
#           /  |                    
#   ______  $$ | __    __   ______  
#  /      \ $$ |/  |  /  | /      \ 
# /$$$$$$  |$$ |$$ |  $$ |/$$$$$$  |
# $$ |  $$ |$$ |$$ |  $$ |$$ |  $$ |
# $$ |__$$ |$$ |$$ \__$$ |$$ \__$$ |
# $$    $$/ $$ |$$    $$/ $$    $$/ 
# $$$$$$$/  $$/  $$$$$$/   $$$$$$$ |
# $$ |                    /  \__$$ |
# $$ |                    $$    $$/ 
# $$/                      $$$$$$/          
# 
#
# PARAMETER LOOKUP UTILITY GATEWAY
# THE PRIMARY SYSTEM INTERPOLATION LAYER, MANAGES THE NODE PARAMETER RESOLUTION FOR NODES AND EDGES

import re
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from utils.ascii_art import PLUG_EXECUTION, display_colored_art, COLORS

class PLUG:
    def __init__(self, orchestrator):
        self.orchestrator = orchestrator

    def resolve(self, params):
        display_colored_art(PLUG_EXECUTION, COLORS["FG_YELLOW"])

        resolved = {}
        for key, value in params.items():
            resolved[key] = self.resolve_template(value)
        return resolved

    def resolve_template(self, template):
        if not isinstance(template, str):
            return template
            
        def replace_match(match):
            path = match.group(1).strip()
            parts = path.split('.')
            node_id = parts[0]
            value = self.orchestrator.outputs.get(node_id)
            
            # Navigate through nested properties
            for part in parts[1:]:
                if value and isinstance(value, dict):
                    value = value.get(part)
                else:
                    return ''
            
            return str(value) if value is not None else ''
        
        return re.sub(r'{{(.*?)}}', replace_match, template)