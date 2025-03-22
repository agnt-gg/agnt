#             __  __                 
#            /  |/  |                
#  __     __ $$/ $$ |____    ______  
# /  \   /  |/  |$$      \  /      \ 
# $$  \ /$$/ $$ |$$$$$$$  |/$$$$$$  |
#  $$  /$$/  $$ |$$ |  $$ |$$    $$ |
#   $$ $$/   $$ |$$ |__$$ |$$$$$$$$/ 
#    $$$/    $$ |$$    $$/ $$       |
#     $/     $$/ $$$$$$$/   $$$$$$$/                   
# 
#
# VISUAL INFERENCE BEHAVIOR EVALUATOR
# THE PRIMARY SYSTEM OBSERVER LAYER, MANAGES THE EDGE AND NODE OUTPUT EVALUATION AND CONDITION CHECKING

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from orchestrator.PLUG import PLUG
from utils.ascii_art import VIBE_ACTIVATION, display_colored_art, COLORS

class VIBE:
    def __init__(self, orchestrator):
        self.plug = PLUG(orchestrator)

    def evaluate(self, edge, node_output):
        # Display the ASCII art with color when evaluating an edge
        display_colored_art(VIBE_ACTIVATION, COLORS["FG_MAGENTA"])

        print('Node output:', node_output, '\n')
        print('Evaluating edge:', edge, '\n')
        
        # CAN DO SECURITY HERE WITH **NOPE** OR CHECK IF THE NODE OUTPUT IS VALID

        # IF VALID, RETURN TRUE

        # IF NOT VALID, RETURN FALSE

        if not edge.get('condition'):
            return True
            
        actual_value = self.plug.resolve_template(edge.get('if', ''))
        expected_value = edge.get('value', '')

        # Convert to numbers for numeric comparisons
        try:
            num_actual = float(actual_value)
            num_expected = float(expected_value)
            numeric_comparison = True
        except (ValueError, TypeError):
            numeric_comparison = False

        condition = edge.get('condition', '')
        
        if condition == 'equals':
            return actual_value == expected_value
        elif condition == 'not_equals':
            return actual_value != expected_value
        elif condition == 'contains':
            return str(actual_value).find(expected_value) >= 0
        elif condition == 'not_contains':
            return str(actual_value).find(expected_value) < 0
        elif condition == 'greater_than' and numeric_comparison:
            return num_actual > num_expected
        elif condition == 'less_than' and numeric_comparison:
            return num_actual < num_expected
        elif condition == 'greater_than_or_equal' and numeric_comparison:
            return num_actual >= num_expected
        elif condition == 'less_than_or_equal' and numeric_comparison:
            return num_actual <= num_expected
        elif condition == 'between' and numeric_comparison:
            try:
                min_val, max_val = map(float, expected_value.split(','))
                return min_val <= num_actual <= max_val
            except (ValueError, AttributeError):
                print(f"Invalid 'between' range: {expected_value}")
                return False
        else:
            print(f"Unknown condition: {condition}")
            return False