from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


Money = Numeric(18, 2)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="viewer", index=True, nullable=False)
    allowed_modules: Mapped[str] = mapped_column(Text, default="", nullable=False)
    signature_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True, nullable=False)
    llp_links: Mapped[list["LLPPartner"]] = relationship(back_populates="user")


class LLP(Base):
    __tablename__ = "llps"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_name: Mapped[str] = mapped_column(String(255), nullable=False)
    short_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    gstin: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    pan: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    address: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class LLPPartner(Base):
    __tablename__ = "llp_partners"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="partner", nullable=False)
    percentage: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    allowed_modules: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    user: Mapped[User] = relationship(back_populates="llp_links")
    llp: Mapped[LLP] = relationship()
    __table_args__ = (UniqueConstraint("llp_id", "user_id", name="uq_llp_partners_llp_user"),)


class Partner(Base):
    __tablename__ = "partners"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    partner_name: Mapped[str] = mapped_column(String(160), nullable=False)
    llp_id: Mapped[str | None] = mapped_column(ForeignKey("llps.id"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    mobile: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    pan: Mapped[str] = mapped_column(String(20), default="", index=True, nullable=False)
    rm_name: Mapped[str] = mapped_column(String(160), default="", index=True, nullable=False)
    segment: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", index=True, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    partner_name: Mapped[str] = mapped_column(String(160), default="", index=True, nullable=False)
    llp_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    family_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    super_family_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Vendor(Base):
    __tablename__ = "vendors"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str | None] = mapped_column(ForeignKey("llps.id"), nullable=True, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    gstin: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    pan: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    state: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    __table_args__ = (UniqueConstraint("llp_id", "vendor_name", name="uq_vendors_llp_name"),)


class LLPPayable(Base, TimestampMixin):
    __tablename__ = "llp_payables"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    vendor_id: Mapped[str | None] = mapped_column(ForeignKey("vendors.id"), nullable=True, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    vendor_category: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    vendor_gstin: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    vendor_pan: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    bill_no: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_bill_no: Mapped[str] = mapped_column(String(120), nullable=False)
    bill_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    expense_type: Mapped[str] = mapped_column(String(120), default="Vendor Bill", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    taxable_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    cgst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    sgst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    igst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    gst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    tcs_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    gross_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    line_items: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tds_section: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    tds_rate: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    tds_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    tds_deducted_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    net_payable: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    paid_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    payment_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    payment_mode: Mapped[str] = mapped_column(String(80), default="Bank", nullable=False)
    bank_account: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reference_no: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    paid_by_type: Mapped[str] = mapped_column(String(40), default="Company", nullable=False)
    paid_by_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reimburse_to: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reimbursement_status: Mapped[str] = mapped_column(String(40), default="Not Required", nullable=False)
    reimbursement_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    reimbursement_ref: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    challan_no: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    challan_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    interest_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="Pending", index=True, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    __table_args__ = (
        UniqueConstraint("llp_id", "vendor_id", "normalized_bill_no", name="uq_payables_llp_vendor_bill"),
        Index("ix_payables_llp_bill", "llp_id", "bill_no"),
    )


class Expense(Base):
    __tablename__ = "expenses"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    expense_date: Mapped[Date | None] = mapped_column(Date, nullable=True, index=True)
    expense_type: Mapped[str] = mapped_column(String(120), default="Misc", nullable=False)
    category: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    paid_by: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    charge_to: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reimburse_to: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    payment_mode: Mapped[str] = mapped_column(String(80), default="Cash", nullable=False)
    taxable_value: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    cgst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    sgst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    igst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    gst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    vendor_or_person: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    bill_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bill_link: Mapped[str] = mapped_column(Text, default="", nullable=False)
    employee_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    billing_month: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    travel_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    partner_allocations: Mapped[str] = mapped_column(Text, default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="Draft", index=True, nullable=False)
    reimburse_mode: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    reimburse_account: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reimburse_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    reimburse_ref: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    reimburse_by: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    approved_by: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Receipt(Base):
    __tablename__ = "receipts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    receipt_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    reference_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    reference_no: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    month: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    amount_received: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    receipt_mode: Mapped[str] = mapped_column(String(80), default="Bank", nullable=False)
    bank_account: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class NeoInvoice(Base, TimestampMixin):
    __tablename__ = "neo_invoices"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str | None] = mapped_column(ForeignKey("llps.id"), nullable=True, index=True)
    raised_by: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    invoice_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    gst_mode: Mapped[str] = mapped_column(String(40), default="Without GST", nullable=False)
    is_proforma: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    invoice_title: Mapped[str] = mapped_column(String(80), default="Invoice", nullable=False)
    invoice_no: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    invoice_date: Mapped[Date | None] = mapped_column(Date, nullable=True)
    billing_month: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    seller_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    seller_address: Mapped[str] = mapped_column(Text, default="", nullable=False)
    seller_gstin: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    seller_pan: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    seller_state: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    buyer_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    buyer_address: Mapped[str] = mapped_column(Text, default="", nullable=False)
    buyer_gstin: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    buyer_state: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    particulars: Mapped[str] = mapped_column(Text, default="", nullable=False)
    sac_code: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    taxable_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    gst_rate: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    gst_type: Mapped[str] = mapped_column(String(40), default="IGST", nullable=False)
    gst_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    tax_amount_in_words: Mapped[str] = mapped_column(Text, default="", nullable=False)
    amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    amount_in_words: Mapped[str] = mapped_column(Text, default="", nullable=False)
    narration: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tds_rate: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    tds_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    net_payable: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    account_no: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    branch_ifsc: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    authorised_signatory: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="Draft", index=True, nullable=False)
    pdf_link: Mapped[str] = mapped_column(Text, default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    __table_args__ = (
        UniqueConstraint("llp_id", "invoice_no", name="uq_neo_invoices_llp_invoice_no"),
        Index("ix_neo_invoices_llp_month", "llp_id", "billing_month"),
    )


class NeoRevenue(Base, TimestampMixin):
    __tablename__ = "neo_revenue"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    pan: Mapped[str] = mapped_column(String(20), default="", index=True, nullable=False)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    rm_name: Mapped[str] = mapped_column(String(160), default="", index=True, nullable=False)
    transaction_date: Mapped[Date | None] = mapped_column(Date, nullable=True, index=True)
    product: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    scheme_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    investment_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    commission_percent: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    revenue_month: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    revenue_amount: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    ytd_value: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    statement_ref: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    partner_name: Mapped[str] = mapped_column(String(160), default="", index=True, nullable=False)
    llp_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    family_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    super_family_name: Mapped[str] = mapped_column(String(255), default="", index=True, nullable=False)
    income_type: Mapped[str] = mapped_column(String(80), default="", index=True, nullable=False)
    invoice_no: Mapped[str] = mapped_column(String(80), default="", index=True, nullable=False)
    invoice_month: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    invoice_status: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    receipt_status: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    __table_args__ = (
        Index("ix_neo_revenue_client_month", "client_name", "revenue_month"),
        Index("ix_neo_revenue_partner_month", "partner_name", "revenue_month"),
    )


class BankAccount(Base, TimestampMixin):
    __tablename__ = "bank_accounts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    account_name: Mapped[str] = mapped_column(String(160), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(160), nullable=False)
    account_number: Mapped[str] = mapped_column(String(80), nullable=False)
    ifsc: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    account_type: Mapped[str] = mapped_column(String(80), default="Current", nullable=False)
    branch: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    opening_balance: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    current_balance: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    __table_args__ = (UniqueConstraint("llp_id", "account_number", name="uq_bank_accounts_llp_number"),)


class CashBookEntry(Base):
    __tablename__ = "cash_book_entries"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    entry_date: Mapped[Date | None] = mapped_column(Date, nullable=True, index=True)
    entry_type: Mapped[str] = mapped_column(String(40), default="Payment", nullable=False)
    opening_balance: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    amount_in: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    amount_out: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    closing_balance: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    reference_type: Mapped[str] = mapped_column(String(120), default="Manual", nullable=False)
    reference_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    paid_by: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
    user_email: Mapped[str] = mapped_column(String(255), default="system", nullable=False)
    module: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    ref_no: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    old_value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    new_value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    remarks: Mapped[str] = mapped_column(Text, default="", nullable=False)


class UploadedBill(Base):
    __tablename__ = "uploaded_bills"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str | None] = mapped_column(ForeignKey("llps.id"), nullable=True, index=True)
    source_type: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    source_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Setting(Base, TimestampMixin):
    __tablename__ = "settings"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str | None] = mapped_column(ForeignKey("llps.id"), nullable=True, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    __table_args__ = (UniqueConstraint("llp_id", "key", name="uq_settings_llp_key"),)
