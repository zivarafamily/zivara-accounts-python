import argparse
import csv
from pathlib import Path

from app.database import Base, SessionLocal, engine
from app.models import NeoInvoice
from app.services.neo_invoices import apply_neo_invoice_payload, create_neo_invoice


def run_migrations():
    Base.metadata.create_all(bind=engine)


def clean_row(row: dict[str, str]) -> dict[str, str]:
    return {str(k or "").strip(): v for k, v in row.items() if str(k or "").strip()}


def import_csv(path: Path):
    run_migrations()
    db = SessionLocal()
    imported = 0
    updated = 0
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for raw in reader:
                row = clean_row(raw)
                invoice_id = row.get("NeoInvoiceID")
                if not invoice_id:
                    continue
                item = db.get(NeoInvoice, invoice_id)
                if item:
                    apply_neo_invoice_payload(db, item, row, row.get("SellerLLPID") or item.llp_id)
                    updated += 1
                else:
                    create_neo_invoice(db, row, row.get("SellerLLPID") or None)
                    imported += 1
        db.commit()
    finally:
        db.close()
    print(f"NeoInvoices import complete: imported={imported}, updated={updated}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()
    import_csv(args.csv_path)


if __name__ == "__main__":
    main()
