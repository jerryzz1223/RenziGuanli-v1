# Attendance Company Isolation and Monthly Lock Contract

## Status

Design only. This document authorizes no migration, API, generator, payroll, or data change. It is the contract for the next attendance phase after review by the payroll owner.

## Current Gap

- `HRMS Attendance Import Batch` has no `company` field.
- `HRMS Attendance Day Check` has no `company` field.
- `HRMS Monthly Attendance Summary` already declares `company`, `attendance_lock_version`, and `lock_status`, but the monthly generator does not populate them.
- `generate_monthly_attendance_summary(attendance_month)` deletes every row for the month without a company filter, then recreates summaries. A locked period can therefore be overwritten.
- There is no explicit lock/unlock API or immutable audit trail.

## Authority and Scope

- HRMS is the source of truth for final attendance and payroll inputs.
- `Company` is the isolation boundary. Exported department, attendance group, and DingTalk organization fields are source attributes, never the company authority.
- The employee master `Employee.company` is authoritative for employee-company membership.
- A row without a resolved employee/company remains an exception and cannot enter a daily final or monthly summary.
- Payroll may read only an attendance period that is locked for the same company and month.

## Required Records

| Record | Required company field | Natural identity | Write rule |
| --- | --- | --- | --- |
| `HRMS Attendance Import Batch` | `company: Link Company, reqd` | `company + source_checksum` | Re-importing the same file for the same company is idempotent: return the existing batch or reject it explicitly. |
| `HRMS Attendance Day Check` | `company: Link Company, reqd` | `company + employee + attendance_date` | The trial write path requires `employee`; unmatched work-code/UserId rows remain in the exception queue. A correction does not overwrite a locked row. |
| `HRMS Monthly Attendance Summary` | `company: Link Company, reqd` | `company + attendance_month + employee + attendance_lock_version` | A row belongs to one immutable monthly version. The current draft and locked snapshot can coexist by version. |
| `HRMS Attendance Month Lock` (new parent record) | `company: Link Company, reqd` | `company + attendance_month` | Holds the current state, active version, source checksum, and lock owner/time. |
| `HRMS Attendance Lock Audit` (new append-only record) | `company: Link Company, reqd` | generated document name | Records every lock, unlock, correction-version creation, actor, timestamp, reason, previous state, and resulting version. |

Frappe validation and a database-level composite index must enforce the two operational identities:

```text
DayCheck:      unique(company, employee, attendance_date, correction_version)
MonthSummary:  unique(company, attendance_month, employee, attendance_lock_version)
```

For the first pilot, `correction_version` on `DayCheck` defaults to the active month version. This prevents a correction from changing a row already included in a locked monthly snapshot.

## State Model

```text
Draft -> Locked -> Reopened -> Draft(next version) -> Locked(next version)
                  \-> Superseded historical snapshot retained
```

- `Draft`: daily checks can be recalculated only within `(company, month, active_version)`.
- `Locked`: the generator, import replacement, and manual mutation APIs reject changes for this company/month/version.
- `Reopened`: requires a reason; existing locked summaries remain immutable and visible as the prior version. The next correction version is prepared as Draft.
- `Superseded`: a historical locked version replaced by a later locked correction version. It remains readable and auditable, but payroll defaults to the current locked version only.

## API Contract

### `generate_monthly_attendance_summary(company, attendance_month)`

- Requires `company` and validates `YYYY-MM`.
- Loads exactly one `HRMS Attendance Month Lock` record for `(company, attendance_month)`.
- Rejects `Locked`; it must not delete, update, or regenerate a locked version.
- Reads day checks, approved effective events, and import batches filtered by the same company and active draft version.
- Uses upsert only inside `(company, month, employee, active_version)`; it never calls a month-wide delete.
- Returns `company`, `attendance_month`, `attendance_lock_version`, generated/updated counts, source batch ids, and source checksum.

### `lock_attendance_month(company, attendance_month, reason)`

- HR Manager or System Manager only.
- Requires no unresolved employee/company mappings and no blocking daily exceptions for the active version.
- Stores source batch ids and a deterministic source checksum on the lock and each summary row.
- Sets the active version to `Locked`, records `locked_by` and `locked_on`, and appends a `LOCK` audit record.
- Returns an immutable payroll input reference: `company`, `attendance_month`, `attendance_lock_version`, `source_checksum`.

### `unlock_attendance_month(company, attendance_month, reason)`

- HR Manager or System Manager only; `reason` is required.
- Does not delete or alter locked rows.
- Sets the current lock state to `Reopened`, appends an `UNLOCK` audit record, and creates the next Draft correction version only after a reviewed correction batch exists.
- Payroll reads the previously locked version until a later version is locked.

### `get_locked_attendance_for_payroll(company, attendance_month)`

- Requires an exact company and month; never chooses a global “latest” record.
- Returns only `lock_status == "已锁定"` rows from the active locked version.
- Includes version, checksum, and summary document ids so a salary trial is traceable to one immutable attendance source.

## Company Resolution Rules

1. Import UI selects a company before any write operation. The selection is recorded on the batch.
2. For every candidate day row, resolve `Employee` by approved mapping rules, then read `Employee.company`.
3. If the employee company differs from the selected batch company, reject the row into the exception queue; never move the employee or change company from a DingTalk export.
4. If a row has no employee or company, retain the private source evidence and create a mapping exception. It cannot generate a DayCheck final or MonthlySummary.
5. Every list, generation, lock, export, and payroll query must filter by company first.

## Payroll Handoff Contract

The attendance module provides one read-only data set per locked company/month/version:

```text
company
attendance_month
attendance_lock_version
employee
employee_code
standard_hours
actual_attendance_hours
leave_hours
absent_hours
overtime_1_5_settlement_hours
overtime_2_settlement_hours
overtime_3_settlement_hours
night_shift_allowance
full_attendance_deduction
apple_reward_amount
source_checksum
```

The payroll module must reject draft, reopened, cross-company, and checksum-missing attendance data. It may retain the returned version/checksum on the salary trial record, but it must not mutate attendance summaries.

## Acceptance Scenarios for the Next Phase

1. Two companies import the same attendance month. Each query returns only its own batch, daily checks, and monthly summaries.
2. A duplicate source file for the same company is detected by checksum and does not create a second batch.
3. An employee mapped to another company is not written into the selected company's daily checks.
4. A monthly generator for Company A does not delete or change Company B records for the same month.
5. Locking Company A / 2026-07 prevents regeneration and manual replacement of its active version.
6. Unlocking with a reason retains version 1, creates an audit event, and permits only a new draft version 2.
7. Payroll can read Company A / 2026-07 version 1 only while version 1 is the active locked version, and rejects every draft.

## Coordination Decision Needed

Before implementation, the payroll owner must confirm that `attendance_lock_version` and `source_checksum` are stored on the salary-trial input record. This is the shared handoff key that prevents a rerun or correction from silently changing a completed payroll trial.
