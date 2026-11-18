from datetime import datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook

from app.database import SessionLocal
from app.models import NeoRevenue
from app.routes.imports import _neo_revenue_import_rows

HEADERS = ['PAN', 'Client Name', 'Partner Name', 'Date', 'Product', 'Tnx Type',
           'Scheme Name', 'Amount', 'Commission %', 'Remarks', 'Gross Revenue', 'Income Type']


def statement(title='NeoRevenue', gross='Gross Revenue', rate='1.78%'):
    wb = Workbook()
    ws = wb.active
    ws.title = title
    headers = HEADERS.copy()
    headers[10] = gross
    ws.append(headers)
    ws.append(['TESTPAN1', 'Test Client', 'Test Partner', datetime(2026, 6, 30),
               'AIF', 'Purchase', 'Test Fund', 10000, rate, 'Adjustment', -178.005, 'Transactional'])
    ws.append([None, 'Total'] + [None] * 8 + [-178.005])
    return wb


def upload(client, headers, wb, month='Aug-2026'):
    data = BytesIO()
    wb.save(data)
    return client.post('/imports/neo-revenue-workbook', headers=headers,
                       data={'revenue_month': month},
                       files={'file': ('test.xlsx', data.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')})


@pytest.mark.parametrize('title', ['NeoRevenue', 'Sheet1'])
@pytest.mark.parametrize('gross', ['Gross Revenue', "Gross Revenue Aug'26", "Gross Rev July'26", "Gross Rev Sep'26", "Gross Rev Oct'26"])
def test_template_and_native_headers_import_and_retry(client, auth_headers, title, gross):
    wb = statement(title, gross)
    res = upload(client, auth_headers, wb)
    assert res.status_code == 200, res.text
    assert res.json()['summary']['NeoRevenue']['imported'] == 1
    with SessionLocal() as db:
        row = db.query(NeoRevenue).one()
        assert row.client_name == 'Test Client'
        assert row.partner_name == 'Test Partner'
        assert row.transaction_date.isoformat() == '2026-06-30'
        assert row.revenue_month == 'Aug-2026'
        assert row.revenue_amount == Decimal('-178.00')
        assert row.commission_percent == Decimal('1.78')
        assert row.investment_amount == Decimal('10000.00')
        assert row.notes == 'Adjustment'
        assert row.income_type == 'Transactional'
    retry = upload(client, auth_headers, wb)
    summary = retry.json()['summary']['NeoRevenue']
    assert summary['imported'] == 0
    assert summary['skipped'] == 1
    assert 'Duplicate' in summary['errors'][0]['message']


def test_excel_percentage_ratio_and_canonical_percentage_points():
    wb = statement(rate=0.01603333)
    wb.active['I2'].number_format = '0.0000%'
    row = list(_neo_revenue_import_rows(wb, 'Sep-2026'))[0][1]
    assert row['CommissionPercent'] == Decimal('1.60333300')
    wb.active['I1'] = 'CommissionPercent'
    wb.active['I2'] = 0.5
    row = list(_neo_revenue_import_rows(wb, 'Sep-2026'))[0][1]
    assert row['CommissionPercent'] == 0.5


def test_canonical_metadata_and_selected_month_preserved():
    wb = Workbook()
    wb.active.title = 'NeoRevenue'
    wb.active.append(['ClientName', 'RevenueAmount', 'RevenueMonth', 'RevenueID', 'LLPName', 'StatementRef'])
    wb.active.append(['Test Client', -2.5, 'Aug-2025', 'REV_TEST', 'Test LLP', 'original'])
    row = list(_neo_revenue_import_rows(wb, 'Aug-2026'))[0][1]
    assert (row['RevenueID'], row['LLPName'], row['StatementRef']) == ('REV_TEST', 'Test LLP', 'original')
    assert row['RevenueMonth'] == 'Aug-2026'
    assert row['RevenueAmount'] == -2.5


def test_abbreviated_total_mismatch_rejected(client, auth_headers):
    wb = statement(gross="Gross Rev Sep'26")
    wb.active['K3'] = 999
    res = upload(client, auth_headers, wb)
    assert res.status_code == 400
    assert 'total mismatch' in res.json()['detail']


def test_download_template_is_real_xlsx_and_round_trips(client, auth_headers):
    path = Path(__file__).resolve().parents[2] / 'frontend/public/templates/neo-revenue-import-template.xlsx'
    assert path.read_bytes().startswith(b'PK')
    wb = load_workbook(path)
    assert wb.sheetnames == ['NeoRevenue']
    assert [c.value for c in wb.active[1]] == HEADERS
    assert not list(_neo_revenue_import_rows(wb, 'Aug-2026'))  # no accidental sample imports
    for index, cell in enumerate(statement().active[2], start=1):
        wb.active.cell(2, index, cell.value)
    assert upload(client, auth_headers, wb).json()['summary']['NeoRevenue']['imported'] == 1


def test_multiple_statement_tabs_rejected_before_writes(client, auth_headers):
    wb = statement(title='August', gross="Gross Rev Aug'26")
    ws = wb.copy_worksheet(wb.active)
    ws.title = 'September'
    ws['K1'] = "Gross Rev Sep'26"
    res = upload(client, auth_headers, wb)
    assert res.status_code == 400
    assert 'one Neo statement worksheet' in res.json()['detail']
    with SessionLocal() as db:
        assert db.query(NeoRevenue).count() == 0


@pytest.mark.parametrize('client_header', ['ClientName', 'Client Name'])
def test_partial_canonical_update_preserves_absent_optional_fields(client, auth_headers, client_header):
    payload = {
        'ClientName': 'Synthetic Partial Client', 'PAN': 'TESTPAN99',
        'RevenueMonth': 'Aug-2026', 'RevenueAmount': '100.00',
        'TransactionDate': '2026-06-30', 'Product': 'AIF',
        'TransactionType': 'Purchase', 'SchemeName': 'Synthetic Fund',
        'InvestmentAmount': '50000.25', 'CommissionPercent': '1.78',
        'RMName': 'Synthetic RM', 'PartnerName': 'Synthetic Partner',
        'Notes': 'Keep this note', 'IncomeType': 'Transactional',
        'StatementRef': 'Original statement', 'YTDValue': '700.50',
    }
    created = client.post('/neo-revenue', headers=auth_headers, json=payload)
    assert created.status_code == 200, created.text
    before = created.json()['data']
    wb = Workbook()
    wb.active.title = 'NeoRevenue'
    wb.active.append(['RevenueID', client_header, 'RevenueAmount', 'RevenueMonth'])
    wb.active.append([before['RevenueID'], before['ClientName'], 125.75, 'Aug-2025'])
    parsed = list(_neo_revenue_import_rows(wb, 'Aug-2026'))[0][1]
    for field in payload.keys() - {'ClientName', 'RevenueAmount', 'RevenueMonth'}:
        assert field not in parsed
    res = upload(client, auth_headers, wb)
    assert res.status_code == 200, res.text
    assert res.json()['summary']['NeoRevenue']['imported'] == 1
    rows = client.get('/neo-revenue', headers=auth_headers).json()['data']
    assert len(rows) == 1
    after = rows[0]
    assert after['RevenueAmount'] == 125.75
    assert after['RevenueMonth'] == 'Aug-2026'
    for field in payload.keys() - {'RevenueAmount'}:
        assert after[field] == before[field], field


def test_minimal_canonical_new_row_uses_service_defaults(client, auth_headers):
    wb = Workbook()
    wb.active.title = 'NeoRevenue'
    wb.active.append(['ClientName', 'RevenueAmount', 'RevenueMonth'])
    wb.active.append(['Synthetic Minimal Client', 12.5, 'Aug-2026'])
    res = upload(client, auth_headers, wb)
    assert res.status_code == 200, res.text
    assert res.json()['summary']['NeoRevenue']['imported'] == 1
    row = client.get('/neo-revenue', headers=auth_headers).json()['data'][0]
    assert row['RevenueAmount'] == 12.5
    assert row['IncomeType'] == ''
    assert row['StatementRef'] == ''
    assert row['Product'] == ''
