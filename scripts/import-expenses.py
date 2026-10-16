import os
import sys
import json
import zipfile
import urllib.request
import urllib.parse
from datetime import date, datetime, timedelta
from xml.etree import ElementTree as ET

DEFAULT_CAT_COLORS = {
    "Groceries": "#22c55e", "Eating Out": "#f97316", "Gas": "#eab308",
    "Electric": "#facc15", "Water": "#0ea5e9", "Mortgage": "#8b5cf6",
    "House Maintenance": "#a78bfa", "Car Gas": "#f59e0b", "Car Loan": "#7c3aed",
    "Trash": "#6b7280", "Internet": "#14b8a6", "Phone": "#06b6d4",
    "Ebay Earnings": "#16a34a", "Ebay Spending": "#ef4444",
    "Magic the Gathering": "#ec4899", "Car Insurance": "#475569",
    "Spotify": "#1db954", "Tithe": "#64748b", "Travel": "#3b82f6",
}

def load_env(path=".env.local"):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

load_env()

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
HOUSEHOLD_ID = os.environ.get("HOUSEHOLD_ID")

if not SUPABASE_URL or not SERVICE_KEY or not HOUSEHOLD_ID:
    print("Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and HOUSEHOLD_ID.")
    sys.exit(1)

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def xlsx_sheets(path):
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rid_to_target = {r.get("Id"): r.get("Target") for r in rels}
    shared = []
    root = ET.fromstring(z.read("xl/sharedStrings.xml"))
    for si in root.findall("x:si", NS):
        shared.append("".join(t.text or "" for t in si.findall(".//x:t", NS)))
    result = {}
    for sheet in wb.find("x:sheets", NS):
        target = "xl/" + rid_to_target[sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")].lstrip("/")
        root_sheet = ET.fromstring(z.read(target))
        rows = {}
        for row in root_sheet.findall("x:sheetData/x:row", NS):
            r = int(row.get("r"))
            cells = {}
            for c in row.findall("x:c", NS):
                ref = c.get("r")
                col = "".join(ch for ch in ref if ch.isalpha())
                t = c.get("t")
                v = c.find("x:v", NS)
                if t == "s":
                    value = shared[int(v.text)] if v is not None else ""
                elif t == "inlineStr":
                    tn = c.find("x:is/x:t", NS)
                    value = tn.text if tn is not None else ""
                else:
                    value = v.text if v is not None else ""
                cells[col] = value
            rows[r] = cells
        result[sheet.get("name")] = rows
    return result

def col_index(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - ord("A") + 1)
    return n - 1

def serial_to_date(serial):
    return datetime(1899, 12, 30) + timedelta(days=int(float(serial)))

def rest(method, path, query=None, body=None, prefer=None):
    url = SUPABASE_URL.rstrip("/") + "/rest/v1" + path
    if query:
        url += "?" + urllib.parse.urlencode(query, doseq=True)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as res:
        raw = res.read().decode("utf-8")
        return json.loads(raw) if raw else []

def classify_account(name):
    lowered = name.lower()
    if "mortgage" in lowered or "we owe" in lowered or "loan" in lowered:
        return "loan"
    if any(k in lowered for k in ["401", "ira", "hsa", "fidelity", "schwab", "retirement", "principal"]):
        return "retirement"
    return "liquid"

def create_if_missing(table, household_filter, name, payload):
    existing = rest("GET", f"/{table}", query={"household_id": f"eq.{HOUSEHOLD_ID}", "name": f"eq.{name}", "select": "id,name"})
    if existing:
        return existing[0]["id"]
    created = rest("POST", f"/{table}", body=[payload], prefer="return=representation")
    return created[0]["id"]

sheets = xlsx_sheets("Expenses.xlsx")

# Categories + cards from expenses
categories = {}
for name, color in DEFAULT_CAT_COLORS.items():
    categories[name] = None
cards = {}

expense_rows = sheets["Expenses"]
# month columns for 2025/2026
month_cols = {}
for c in range(3, 14):
    import string
    letters = ""
    n = c
    while n >= 0:
        letters = chr(ord("A") + (n % 26)) + letters
        n = n // 26 - 1
        if n < 0:
            break
    # column letter simple A..Z
import string
def idx_to_col(i):
    # i is 0-based
    out = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        out = chr(ord("A") + r) + out
    return out

for idx, (year, month) in enumerate([(2025, m) for m in range(1, 12)], start=3):
    month_cols[idx_to_col(idx - 1)] = f"{year:04d}-{month:02d}-01"
# N -> Dec 2025
month_cols["N"] = "2025-12-01"
# O..Z -> 2026 Jan..Dec
for offset in range(12):
    month_cols[idx_to_col(14 + offset)] = f"2026-{offset + 1:02d}-01"

# Fetch existing categories/cards
existing_categories = rest("GET", "/categories", query={"household_id": f"eq.{HOUSEHOLD_ID}", "select": "id,name"})
cat_map = {c["name"]: c["id"] for c in existing_categories}
existing_cards = rest("GET", "/cards", query={"household_id": f"eq.{HOUSEHOLD_ID}", "select": "id,name"})
card_map = {c["name"]: c["id"] for c in existing_cards}

# create categories/cards encountered
entry_payloads = []
for row_num in sorted(expense_rows):
    if row_num == 1:
        continue
    row = expense_rows[row_num]
    category_name = (row.get("A") or "").strip()
    if not category_name:
        continue
    card_name = (row.get("B") or "").strip()
    if category_name not in cat_map:
        color = DEFAULT_CAT_COLORS.get(category_name, "#6b7280")
        cat_type = "income" if category_name.lower().endswith("earnings") else "expense"
        cat_map[category_name] = create_if_missing(
            "categories",
            HOUSEHOLD_ID,
            category_name,
            {
                "household_id": HOUSEHOLD_ID,
                "name": category_name,
                "color": color,
                "type": cat_type,
                "sort_order": len(cat_map),
                "archived": False,
            },
        )
    if card_name and card_name not in card_map:
        card_map[card_name] = create_if_missing(
            "cards",
            HOUSEHOLD_ID,
            card_name,
            {
                "household_id": HOUSEHOLD_ID,
                "name": card_name,
                "color": "#6b7280",
                "sort_order": len(card_map),
                "archived": False,
            },
        )
    for col, month_key in month_cols.items():
        raw = row.get(col)
        if raw is None or str(raw).strip() == "":
            continue
        try:
            amount = float(raw)
        except ValueError:
            continue
        entry_payloads.append({
            "household_id": HOUSEHOLD_ID,
            "month": month_key,
            "category_id": cat_map[category_name],
            "card_id": card_map.get(card_name) if card_name else None,
            "amount": amount,
            "note": "Imported from Excel",
            "is_imported": True,
        })

# accounts sheet
account_rows = sheets["Accounts"]
# header serial months
account_month_cols = {}
for r1 in [1]:
    row = account_rows.get(r1, {})
    for col, serial in row.items():
        if col in ("A", "B"):
            continue
        try:
            d = serial_to_date(serial).date()
            account_month_cols[col] = d.replace(day=1).isoformat()
        except Exception:
            account_month_cols[col] = None

# existing accounts
existing_accounts = rest("GET", "/accounts", query={"household_id": f"eq.{HOUSEHOLD_ID}", "select": "id,name"})
account_map = {a["name"]: a["id"] for a in existing_accounts}

balance_payloads = []
# account row labels from col A
for row_num in sorted(account_rows):
    if row_num == 1:
        continue
    row = account_rows[row_num]
    name = (row.get("A") or "").strip()
    if not name:
        continue
    # skip total/change rows
    if name.lower().startswith("total") or name.lower().startswith("change") or name.lower() == "house - we owe":
        pass
    if name.lower().startswith("total") or name.lower().startswith("change"):
        continue
    if name not in account_map:
        acc_type = classify_account(name)
        acc = rest("POST", "/accounts", body=[{
            "household_id": HOUSEHOLD_ID,
            "name": name,
            "type": acc_type,
            "color": "#6b7280",
            "sort_order": len(account_map),
            "archived": False,
        }], prefer="return=representation")
        account_map[name] = acc[0]["id"]
    for col, month_key in account_month_cols.items():
        if not month_key:
            continue
        raw = row.get(col)
        if raw is None or str(raw).strip() == "" or str(raw).strip().lower() == "closed":
            continue
        try:
            balance = float(raw)
        except ValueError:
            continue
        balance_payloads.append({
            "household_id": HOUSEHOLD_ID,
            "account_id": account_map[name],
            "month": month_key,
            "balance": balance,
        })

# delete imported entries
rest("DELETE", "/entries", query={"household_id": f"eq.{HOUSEHOLD_ID}", "is_imported": "eq.true"})

# insert entries in chunks
for i in range(0, len(entry_payloads), 500):
    rest("POST", "/entries", body=entry_payloads[i:i + 500], prefer="return=minimal")

# upsert account balances via merge-duplicates
for i in range(0, len(balance_payloads), 500):
    rest("POST", "/account_balances", body=balance_payloads[i:i + 500], prefer="resolution=merge-duplicates,return=minimal")

print(f"Imported {len(entry_payloads)} entries and {len(balance_payloads)} account balances.")
