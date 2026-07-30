#!/usr/bin/env python3
"""
generate_token.py – CLI script to generate JWT tokens for testing.
Usage:
    python server/bin/generate_token.py [user_id] [roles...]
Example:
    python server/bin/generate_token.py dev-user admin developer
"""

from pathlib import Path
import sys

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from server.core.auth import create_token

def main() -> None:
    user_id = sys.argv[1] if len(sys.argv) > 1 else "dev-user"
    roles = sys.argv[2:] if len(sys.argv) > 2 else ["admin", "developer"]

    token = create_token(user_id=user_id, roles=roles, expires_in_seconds=86400)
    print("=" * 60)
    print(f"Isolyth JWT Bearer Token for user: '{user_id}'")
    print(f"Roles: {roles}")
    print("=" * 60)
    print(token)
    print("=" * 60)

if __name__ == "__main__":
    main()
