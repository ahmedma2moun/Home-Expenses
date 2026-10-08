#!/usr/bin/env python3
"""Idempotent iOS signing setup for CI.

Creates an App Store distribution certificate and provisioning profile ONLY if
they do not already exist for this app; otherwise reuses them.

Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, RUNNER_TEMP, KEYCHAIN_PATH,
     GITHUB_ENV, CERTIFICATE_P12_BASE64 (optional), CERTIFICATE_PASSWORD,
     GH_PAT + GITHUB_REPOSITORY (only needed to store a newly created cert),
     SKIP_CERT_IMPORT (set on a second run for another bundle ID in the same job — the
     certificate is already in the keychain and `security import` fails on a duplicate)
"""
import base64, os, plistlib, subprocess, sys, time
import jwt, requests  # pip install pyjwt cryptography requests

API = "https://api.appstoreconnect.apple.com/v1"
E = os.environ
tmp = E["RUNNER_TEMP"]
keychain = E["KEYCHAIN_PATH"]
password = E.get("CERTIFICATE_PASSWORD") or "ci-p12-password"


def run(*cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def api(method, path, **kw):
    token = jwt.encode(
        {"iss": E["ASC_ISSUER_ID"], "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
        open(E["ASC_KEY_PATH"]).read(), algorithm="ES256", headers={"kid": E["ASC_KEY_ID"]})
    r = requests.request(method, API + path, headers={"Authorization": f"Bearer {token}"}, timeout=60, **kw)
    if not r.ok:
        sys.exit(f"::error::ASC API {method} {path} -> {r.status_code}: {r.text}")
    return r.json()


def import_p12(path):
    if E.get("SKIP_CERT_IMPORT"):
        return
    run("security", "import", path, "-k", keychain, "-P", password, "-T", "/usr/bin/codesign")
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:", "-k", "", keychain,
        stdout=subprocess.DEVNULL)


def p12_cert_pem(path):
    pem = subprocess.run(["openssl", "pkcs12", "-in", path, "-nokeys", "-passin", f"pass:{password}",
                          "-legacy"], capture_output=True, text=True)
    if pem.returncode:  # OpenSSL 1.x / LibreSSL has no -legacy flag
        pem = subprocess.run(["openssl", "pkcs12", "-in", path, "-nokeys", "-passin", f"pass:{password}"],
                             capture_output=True, text=True, check=True)
    return pem.stdout


def p12_serial(path):
    out = subprocess.run(["openssl", "x509", "-noout", "-serial"], input=p12_cert_pem(path),
                         capture_output=True, text=True, check=True).stdout
    return out.strip().split("=")[1].upper()


def p12_describe(path):
    return subprocess.run(["openssl", "x509", "-noout", "-subject", "-enddate"], input=p12_cert_pem(path),
                          capture_output=True, text=True, check=True).stdout.strip()


def list_certs():
    # DISTRIBUTION = "Apple Distribution" (current); IOS_DISTRIBUTION = legacy "iPhone Distribution".
    return api("GET", "/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=200")["data"]


def create_cert():
    if not E.get("GH_PAT"):
        sys.exit("::error::No distribution certificate secret and no GH_PAT to store a new one. "
                 "Add GH_PAT (repo secrets write) or provide IOS_CERTIFICATE_P12_BASE64.")
    if list_certs():
        sys.exit("::error::A distribution certificate already exists in the Apple account but its private "
                 "key is not available. Set IOS_CERTIFICATE_P12_BASE64 to its .p12 (or revoke it) - "
                 "refusing to create another.")
    key, csr = f"{tmp}/dist.key", f"{tmp}/dist.csr"
    run("openssl", "req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr,
        "-subj", f"/CN={E['BUNDLE_ID']} CI Distribution/O=CI")
    body = {"data": {"type": "certificates", "attributes": {
        "certificateType": "DISTRIBUTION", "csrContent": open(csr).read()}}}
    data = api("POST", "/certificates", json=body)["data"]
    cer, pem, p12 = f"{tmp}/dist.cer", f"{tmp}/dist.pem", f"{tmp}/cert.p12"
    open(cer, "wb").write(base64.b64decode(data["attributes"]["certificateContent"]))
    run("openssl", "x509", "-inform", "der", "-in", cer, "-out", pem)
    run("openssl", "pkcs12", "-export", "-inkey", key, "-in", pem, "-out", p12, "-passout", f"pass:{password}")
    b64 = base64.b64encode(open(p12, "rb").read()).decode()
    gh_env = {**E, "GH_TOKEN": E["GH_PAT"]}
    repo = E["GITHUB_REPOSITORY"]
    run("gh", "secret", "set", "IOS_CERTIFICATE_P12_BASE64", "--repo", repo, "--body", b64, env=gh_env)
    run("gh", "secret", "set", "IOS_CERTIFICATE_PASSWORD", "--repo", repo, "--body", password, env=gh_env)
    print("Created new distribution certificate and stored it in repo secrets.")
    return p12, data["id"]


# --- certificate -----------------------------------------------------------
if E.get("CERTIFICATE_P12_BASE64"):
    p12 = f"{tmp}/cert.p12"
    open(p12, "wb").write(base64.b64decode(E["CERTIFICATE_P12_BASE64"]))
    serial = p12_serial(p12).lstrip("0")
    certs = list_certs()
    cert_id = next((c["id"] for c in certs
                    if c["attributes"]["serialNumber"].upper().lstrip("0") == serial), None)
    if not cert_id:
        print(f"Certificate in secret: {p12_describe(p12)}, serial={serial}")
        print("Distribution certificates in the Apple account:")
        for c in certs:
            a = c["attributes"]
            print(f"  - {a.get('certificateType')} '{a.get('name')}' serial={a['serialNumber'].upper().lstrip('0')} "
                  f"expires={a.get('expirationDate')}")
        sys.exit("::error::The certificate in IOS_CERTIFICATE_P12_BASE64 is not an active distribution "
                 "certificate in this Apple account (revoked/expired?). Remove the secret to have a new one created.")
    print("Reusing existing distribution certificate.")
else:
    p12, cert_id = create_cert()
import_p12(p12)

# --- provisioning profile ---------------------------------------------------
bundle = E["BUNDLE_ID"]
bid = api("GET", f"/bundleIds?filter[identifier]={bundle}&limit=200")["data"]
bid = next((b for b in bid if b["attributes"]["identifier"] == bundle), None)
if not bid:
    sys.exit(f"::error::Bundle ID {bundle} is not registered in the Apple developer account.")

# This related-resource endpoint rejects filter[...] params, so filter client-side.
profiles = api("GET", f"/bundleIds/{bid['id']}/profiles?limit=200")["data"]
profile = None
for p in profiles:
    if p["attributes"]["profileType"] != "IOS_APP_STORE" or p["attributes"]["profileState"] != "ACTIVE":
        continue
    certs = api("GET", f"/profiles/{p['id']}/certificates?limit=200")["data"]
    if any(c["id"] == cert_id for c in certs):
        profile = p
        break
if profile:
    print("Reusing existing provisioning profile.")
else:
    profile = api("POST", "/profiles", json={"data": {
        "type": "profiles",
        "attributes": {"name": f"CI App Store {bundle} {int(time.time())}", "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bid["id"]}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]}}}})["data"]
    print("Created new provisioning profile.")

raw = base64.b64decode(profile["attributes"]["profileContent"])
decoded = subprocess.run(["security", "cms", "-D"], input=raw, capture_output=True, check=True).stdout
info = plistlib.loads(decoded)
dest = os.path.expanduser("~/Library/MobileDevice/Provisioning Profiles")
os.makedirs(dest, exist_ok=True)
open(f"{dest}/{info['UUID']}.mobileprovision", "wb").write(raw)

with open(E["GITHUB_ENV"], "a") as f:
    f.write(f"PROFILE_NAME={info['Name']}\nPROFILE_UUID={info['UUID']}\n")
