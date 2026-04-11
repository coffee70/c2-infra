./.venv/bin/python - <<'PY' | pbcopy
import json
import sys
import urllib.request
from importlib import import_module

OBSERVATION_ID = "13787109"
sys.path.insert(0, ".")
KAITAI_MODULE = "satnogs_adapter.decoders.generated.lasarsat"
KAITAI_CLASS = "Lasarsat"

def fetch_bytes(url):
    with urllib.request.urlopen(url) as r:
        return r.read()

def fetch_json(url):
    return json.loads(fetch_bytes(url).decode())

def simple(v):
    return isinstance(v, (str, int, float, bool, bytes)) or v is None

def preview_bytes(v, limit=80):
    shown = v[:limit]
    return "".join(chr(b) if 32 <= b <= 126 else "." for b in shown)

def dump(obj, prefix="", depth=0, max_depth=4, seen=None):
    if seen is None:
        seen = set()
    oid = id(obj)
    if oid in seen:
        print(f"{prefix}<seen {type(obj).__name__}>")
        return
    seen.add(oid)

    if depth > max_depth:
        print(f"{prefix}<max depth {type(obj).__name__}>")
        return

    names = []
    for name in dir(obj):
        if name.startswith("_"):
            continue
        try:
            val = getattr(obj, name)
        except Exception as e:
            print(f"{prefix}{name}=<error {type(e).__name__}: {e}>")
            continue
        if callable(val):
            continue
        names.append((name, val))

    for name, val in names:
        if simple(val):
            if isinstance(val, bytes):
                print(f"{prefix}{name}=bytes[{len(val)}] {preview_bytes(val)!r}")
            else:
                print(f"{prefix}{name}={val!r}")
        elif isinstance(val, (list, tuple)):
            print(f"{prefix}{name}=<{type(val).__name__} len={len(val)}>")
            for i, item in enumerate(val[:10]):
                if simple(item):
                    if isinstance(item, bytes):
                        print(f"{prefix}  [{i}]=bytes[{len(item)}] {preview_bytes(item)!r}")
                    else:
                        print(f"{prefix}  [{i}]={item!r}")
                else:
                    print(f"{prefix}  [{i}]=<{type(item).__name__}>")
                    dump(item, prefix + f"  [{i}].", depth + 1, max_depth, seen)
        else:
            print(f"{prefix}{name}=<{type(val).__name__}>")
            dump(val, prefix + name + ".", depth + 1, max_depth, seen)

mod = import_module(KAITAI_MODULE)
parser = getattr(mod, KAITAI_CLASS)
obs = fetch_json(f"https://network.satnogs.org/api/observations/{OBSERVATION_ID}/")

for i, d in enumerate(obs["demoddata"], 1):
    data = fetch_bytes(d["payload_demod"])
    obj = parser.from_bytes(data)
    print("=" * 100)
    print(f"FRAME {i}")
    dump(obj, max_depth=5)
PY