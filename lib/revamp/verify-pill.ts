// The look of "sitting at Verify in IN4", in its own file with no imports.
//
// The ribbon and the sidebar tree are client components; lib/revamp/verify-counts
// reaches IN4 through mssql and must never be pulled into a browser bundle. So
// the one thing both sides need — the class string — lives here on its own.
//
// Teal, deliberately NOT the amber used for approvals: amber means the item is
// on your desk in CT Hub, teal means it is parked in IN4 waiting to be verified.
// Two different queues, two different people, so never the same colour.
export const VERIFY_PILL = 'bg-teal-100 text-teal-800 border border-teal-300'
