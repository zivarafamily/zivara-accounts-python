"""Safeguard for Vendor Bill settlements linked to an existing bank transaction.

When PaymentMode is "Existing Bank Transaction", the bank debit already exists in
CashBookEntry/Transactions and has already been posted to the Vendor ledger.

Therefore the payable must update only its settlement metadata/status. Creating a
second system "Payable Payment" bank row would duplicate the bank debit.

This module patches only the payable-payment synchronization path. Bill journals,
personal payments, reimbursements and normal company payments are unchanged.
"""

from app.services import accounting_sync


EXISTING_BANK_PAYMENT_MODES = {
    "existing bank transaction",
    "existing bank txn",
    "existing bank payment",
    "batch settlement - existing bank transaction",
}


def _is_existing_bank_settlement(payable) -> bool:
    return str(getattr(payable, "payment_mode", "") or "").strip().lower() in EXISTING_BANK_PAYMENT_MODES


if not getattr(accounting_sync, "_existing_bank_batch_settlement_patch", False):
    _original_sync_payable_payment = accounting_sync._sync_payable_payment

    def _sync_payable_payment_safe(connection, payable):
        if _is_existing_bank_settlement(payable):
            # Remove any prior generated representation for this bill, but never
            # touch the manually/imported bank transaction being linked.
            accounting_sync._delete_journal(
                connection,
                payable.llp_id,
                "payable_payment_personal",
                payable.id,
            )
            accounting_sync._delete_journal(
                connection,
                payable.llp_id,
                "payable_payment_clearing",
                payable.id,
            )
            accounting_sync._delete_generated_cash(
                connection,
                payable.llp_id,
                "Payable Payment",
                payable.id,
            )
            return

        return _original_sync_payable_payment(connection, payable)

    accounting_sync._sync_payable_payment = _sync_payable_payment_safe
    accounting_sync._existing_bank_batch_settlement_patch = True
