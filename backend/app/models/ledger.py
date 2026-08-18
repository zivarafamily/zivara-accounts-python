from datetime import datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


Money = Numeric(18, 2)


class Ledger(Base):
    __tablename__ = "ledgers"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    ledger_code: Mapped[str] = mapped_column(String(40), nullable=False)
    ledger_name: Mapped[str] = mapped_column(String(255), nullable=False)
    group_name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[str] = mapped_column(String(40), nullable=False)
    opening_balance: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    opening_side: Mapped[str] = mapped_column(String(2), default="Dr", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    system_key: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("llp_id", "ledger_code", name="uq_ledgers_llp_code"),
        UniqueConstraint("llp_id", "ledger_name", name="uq_ledgers_llp_name"),
        Index("ix_ledgers_llp_group", "llp_id", "group_name"),
    )


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    llp_id: Mapped[str] = mapped_column(ForeignKey("llps.id"), index=True, nullable=False)
    entry_date: Mapped[Date | None] = mapped_column(Date, nullable=True, index=True)
    voucher_type: Mapped[str] = mapped_column(String(40), default="Journal", nullable=False)
    voucher_no: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    narration: Mapped[str] = mapped_column(Text, default="", nullable=False)
    source_type: Mapped[str] = mapped_column(String(80), default="manual", nullable=False)
    source_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_journal_source", "llp_id", "source_type", "source_id"),
    )


class JournalLine(Base):
    __tablename__ = "journal_lines"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    journal_entry_id: Mapped[str] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), index=True, nullable=False)
    ledger_id: Mapped[str] = mapped_column(ForeignKey("ledgers.id"), index=True, nullable=False)
    debit: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    credit: Mapped[object] = mapped_column(Money, default=0, nullable=False)
    particulars: Mapped[str] = mapped_column(Text, default="", nullable=False)

    __table_args__ = (
        Index("ix_journal_lines_ledger_entry", "ledger_id", "journal_entry_id"),
    )
