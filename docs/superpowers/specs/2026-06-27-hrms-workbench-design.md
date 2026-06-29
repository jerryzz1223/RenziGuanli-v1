# HRMS Workbench Design

## Goal

Create the first usable main page for the HR system as a native Frappe Page, not by modifying the old Expenses workspace.

## Scope

- Add a new Frappe Desk page at `/desk/hrms-workbench`.
- Keep Frappe's normal authentication, routing, permissions, and page lifecycle.
- Make HRMS application entry and desk redirect open this page.
- Build only the main workbench in this step. Employee roster and other business modules will be designed separately.

## Layout

The page uses the reference home screen structure:

- Top notice bar for HR announcements.
- Calendar and today's to-do summary.
- Quick entry card for common HR actions.
- Recruitment, attendance, onboarding, regularization, resignation, and labor policy cards.
- Right rail with WeChat binding, risk monitor, AI assistant shortcuts, personnel reminders, and personnel overview.

## Data

The first implementation reads available HRMS/Frappe data where possible:

- Employee counts from `Employee`.
- Open jobs from `Job Opening`.
- Interviews from `Interview`.
- Attendance from `Attendance`.
- Leave requests from `Leave Application`.
- Onboarding from `Employee Onboarding`.
- Separation from `Employee Separation`.

When a DocType or records are not available, the page returns zero values instead of failing.

## Integration

- The page lives under `hrms/hr/page/hrms_workbench`.
- Python exposes a whitelisted `get_data` method for dashboard data.
- JavaScript renders the page and calls the backend method.
- CSS is scoped under `.hrms-workbench` to avoid affecting other Frappe pages.
- `hooks.py` points `app_home` and app launcher route to `/desk/hrms-workbench`.
- Existing redirect JavaScript sends `/desk` and `/apps` to `/desk/hrms-workbench`.

## Verification

- Run Frappe migration to sync the new Page.
- Clear cache.
- Open `/desk/hrms-workbench` and confirm the page renders.
- Confirm the HRMS app entry and `/desk` redirect land on the new page.
