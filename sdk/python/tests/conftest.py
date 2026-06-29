"""Make the SDK package and examples importable when running pytest from sdk/python."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
