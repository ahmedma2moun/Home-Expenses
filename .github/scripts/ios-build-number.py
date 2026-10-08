#!/usr/bin/env python3
"""Print the next iOS build number (CFBundleVersion) for CI.

Asks App Store Connect for the highest build number already uploaded for the app
and prints that + 1, so TestFlight never rejects the upload as a duplicate.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID
"""
import os, sys, time
import jwt, requests  # pip install pyjwt cryptography requests

API = "https://api.appstoreconnect.apple.com/v1"
E = os.environ


def api(path):
    token = jwt.encode(
        {"iss": E["ASC_ISSUER_ID"], "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
        open(E["ASC_KEY_PATH"]).read(), algorithm="ES256", headers={"kid": E["ASC_KEY_ID"]})
    r = requests.get(API + path, headers={"Authorization": f"Bearer {token}"}, timeout=60)
    if not r.ok:
        sys.exit(f"::error::ASC API GET {path} -> {r.status_code}: {r.text}")
    return r.json()


bundle = E["BUNDLE_ID"]
apps = [a for a in api(f"/apps?filter[bundleId]={bundle}&limit=200")["data"]
        if a["attributes"]["bundleId"] == bundle]
if not apps:
    sys.exit(f"::error::No App Store Connect app record for {bundle}. Create it under Apps -> New App.")

highest = 0
for b in api(f"/builds?filter[app]={apps[0]['id']}&sort=-uploadedDate&limit=200")["data"]:
    version = b["attributes"]["version"]  # CFBundleVersion, e.g. "36"
    if version.isdigit():
        highest = max(highest, int(version))

print(f"Highest uploaded build number: {highest}", file=sys.stderr)
print(highest + 1)
