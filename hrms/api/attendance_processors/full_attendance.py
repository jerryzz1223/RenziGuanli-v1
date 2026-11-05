"""Full-attendance award: actual leave tiers and a separate late penalty."""
from decimal import Decimal


POLICY_VERSION = "2026-10-30"


def calculate_full_attendance(values):
    def hours(key):
        return max(Decimal(str(values.get(key) or 0)), Decimal(0))

    # Paid attendance and overtime offsets must not hide actual leave. Annual,
    # arranged rest and reunion leave remain exempt under the existing policy.
    leave = sum((hours(key) for key in (
        "personal_leave_hours", "sick_leave_hours", "bereavement_leave_hours",
        "marriage_leave_hours", "public_leave_hours", "maternity_leave_hours",
    )), Decimal(0))
    leave += hours("work_injury_hours") if "work_injury_hours" in values else hours("work_injury_leave_hours")
    leave = max(leave, hours("leave_hours") - hours("annual_leave_hours")
                - hours("reunion_leave_hours")
                - (hours("rest_arrangement_hours") if "rest_arrangement_hours" in values else hours("rest_leave_hours")))
    # Some draft rows create personal-leave hours solely to represent lateness.
    # Those hours are still attendance absence, but must not enter leave tiers.
    late_leave = hours("late_personal_leave_hours")
    leave = max(leave - min(late_leave, hours("personal_leave_hours")), Decimal(0))
    absence = hours("absence_hours") if "absence_hours" in values else hours("absent_hours")
    # Keep unexplained unworked hours (for example before joining) in the
    # absence basis. Lateness has its own penalty and must not cross a tier.
    rest = hours("rest_arrangement_hours") if "rest_arrangement_hours" in values else hours("rest_leave_hours")
    uncovered = max(hours("standard_hours") - hours("actual_attendance_hours")
                    - hours("annual_leave_hours") - rest - hours("reunion_leave_hours")
                    - max(late_leave, hours("late_count") * Decimal("0.5")), Decimal(0))
    basis = max(leave + absence, uncovered)
    award = Decimal(0)
    for maximum, amount in ((0, 200), (16, 150), (32, 100), (48, 50)):
        if basis <= maximum:
            award = Decimal(amount)
            break
    late_deduction = hours("late_count") * 10
    net = max(award - late_deduction, Decimal(0))
    return {
        "leave_hours": float(leave), "absence_basis": float(basis),
        "leave_award": float(award), "late_deduction": float(late_deduction),
        "award": float(net), "deduction": float(200 - net),
    }
