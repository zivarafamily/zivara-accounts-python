from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook
from app.database import SessionLocal
from app.models import CashBookEntry, Expense, LLPPayable, UploadedBill
from app.services.payables import calculate_amounts


def test_auth(client):
    res = client.post("/auth/login", json={"username": "admin", "password": "ChangeMe123!"})
    assert res.status_code == 200
    assert res.json()["access_token"]
    assert res.json()["llps"][0]["llpId"] == "LLP001"


def test_auth_me_works_with_token(client):
    login = client.post("/auth/login", json={"username": "admin", "password": "ChangeMe123!"})
    token = login.json()["access_token"]
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["user"] == "admin"


def test_payable_calculations():
    taxable, gst, gross, rate, tds, net = calculate_amounts({"TaxableAmount": "1000", "GSTAmount": "180", "TDSRate": "10"})
    assert taxable == Decimal("1000.00")
    assert gst == Decimal("180.00")
    assert gross == Decimal("1180.00")
    assert tds == Decimal("100.00")
    assert net == Decimal("1080.00")


def test_duplicate_payable_rejection(client, auth_headers):
    v = client.post("/vendors", headers=auth_headers, json={"VendorName": "ABC Co"})
    vendor_id = v.json()["data"]["VendorID"]
    payload = {"VendorID": vendor_id, "VendorName": "ABC Co", "BillNo": "INV-1", "BillDate": "2026-06-10", "TaxableAmount": "1000", "GSTAmount": "180", "TDSRate": "10"}
    assert client.post("/payables", headers=auth_headers, json=payload).status_code == 200
    assert client.post("/payables", headers=auth_headers, json=payload).status_code == 409


def test_expense_duplicate_warning(client, auth_headers):
    payload = {"Date": "2026-06-10", "Amount": "500", "PaidBy": "Dinu", "Description": "Cab"}
    assert client.post("/expenses", headers=auth_headers, json=payload).status_code == 200
    res = client.post("/expenses", headers=auth_headers, json=payload)
    assert res.status_code == 200
    assert res.json()["duplicateWarning"] is True


def test_expense_approval_and_petty_cash_reimbursement(client, auth_headers):
    created = client.post("/expenses", headers=auth_headers, json={"Date": "2026-06-10", "Amount": "750", "PaidBy": "Dinu", "Description": "Fuel"}).json()
    expense_id = created["data"]["ExpenseID"]
    assert client.post(f"/expenses/{expense_id}/approve", headers=auth_headers, json={}).status_code == 200
    res = client.post(f"/expenses/{expense_id}/reimburse", headers=auth_headers, json={"ReimburseMode": "Petty Cash", "ReimburseAccount": "Petty Cash"})
    assert res.status_code == 200
    cash = client.get("/cash-book", headers=auth_headers).json()["data"]
    assert len(cash) == 1
    assert cash[0]["AmountOut"] == 750.0


def test_dashboard_and_reports(client, auth_headers):
    client.post("/receipts", headers=auth_headers, json={"Date": "2026-06-10", "AmountReceived": "1000"})
    dash = client.get("/reports/dashboard", headers=auth_headers).json()["summary"]
    assert dash["receipts_total"] == 1000.0
    assert client.get("/reports/reconciliation", headers=auth_headers).status_code == 200
    assert client.get("/reports/ca-tds", headers=auth_headers).status_code == 200


def test_llp_scoped_create_requires_x_llp_id(client):
    login = client.post("/auth/login", json={"username": "admin", "password": "ChangeMe123!"})
    token = login.json()["access_token"]
    res = client.post(
        "/expenses",
        headers={"Authorization": f"Bearer {token}"},
        json={"Date": "2026-06-10", "Amount": "100", "Description": "No LLP"},
    )
    assert res.status_code == 400


def test_llp_scoped_create_succeeds_with_allowed_llp(client, auth_headers):
    res = client.post(
        "/expenses",
        headers=auth_headers,
        json={"Date": "2026-06-10", "Amount": "100", "Description": "With LLP"},
    )
    assert res.status_code == 200


def test_bill_upload_requires_auth(client):
    res = client.post(
        "/uploads/bills",
        files={"file": ("bill.pdf", b"fake pdf", "application/pdf")},
        data={"source_type": "expense", "source_id": "EXP1"},
        headers={"X-LLP-ID": "LLP001"},
    )
    assert res.status_code == 401


def test_bill_upload_rejects_unsupported_extension(client, auth_headers):
    res = client.post(
        "/uploads/bills",
        files={"file": ("bill.exe", b"nope", "application/octet-stream")},
        data={"source_type": "expense", "source_id": "EXP1"},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_bill_upload_saves_metadata_and_updates_expense(client, auth_headers):
    created = client.post(
        "/expenses",
        headers=auth_headers,
        json={"Date": "2026-06-10", "Amount": "250", "PaidBy": "Dinu", "Description": "Hotel"},
    ).json()
    expense_id = created["data"]["ExpenseID"]
    res = client.post(
        "/uploads/bills",
        files={"file": ("bill.pdf", b"fake pdf", "application/pdf")},
        data={"source_type": "expense", "source_id": expense_id},
        headers=auth_headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["fileId"]
    assert body["sourceType"] == "expense"
    assert body["sourceId"] == expense_id

    db = SessionLocal()
    try:
        upload = db.get(UploadedBill, body["fileId"])
        expense = db.get(Expense, expense_id)
        assert upload is not None
        assert upload.llp_id == "LLP001"
        assert upload.original_filename == "bill.pdf"
        assert expense.bill_available is True
        assert expense.bill_link
    finally:
        db.close()


def test_accounts_workbook_imports_expenses_payables_and_bank_statement(client, auth_headers):
    wb = Workbook()
    expenses = wb.active
    expenses.title = "Expenses"
    expenses.append(["LLPID", "Date", "ExpenseType", "Amount", "PaidBy", "Description"])
    expenses.append(["LLP001", "2026-06-10", "Travel", 500, "Dinu", "Cab"])

    payables = wb.create_sheet("Payables")
    payables.append(["LLPID", "VendorName", "BillNo", "BillDate", "TaxableAmount", "GSTAmount", "TDSRate"])
    payables.append(["LLP001", "ABC Co", "INV-100", "2026-06-10", 1000, 180, 10])

    bank = wb.create_sheet("BankStatement")
    bank.append(["LLPID", "Date", "Narration", "Debit", "Credit", "Balance", "ReferenceNo"])
    bank.append(["LLP001", "2026-06-11", "Vendor payment", 750, "", 9250, "UTR1"])

    stream = BytesIO()
    wb.save(stream)
    stream.seek(0)

    res = client.post(
        "/imports/accounts-workbook",
        headers=auth_headers,
        files={"file": ("accounts.xlsx", stream.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200
    summary = res.json()["summary"]
    assert summary["Expenses"]["imported"] == 1
    assert summary["LLPPayables"]["imported"] == 1
    assert summary["BankStatement"]["imported"] == 1

    db = SessionLocal()
    try:
        assert db.query(Expense).count() == 1
        assert db.query(LLPPayable).count() == 1
        assert db.query(CashBookEntry).count() == 1
    finally:
        db.close()
