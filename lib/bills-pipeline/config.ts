export const BP_CONFIG = {
  PORTAL_ID: '60062895348',

  PROJECTS: {
    NGH: '395368000000741425',
    P2:  '395368000001110066',
    VV:  '395368000001107938',
    EK:  '395368000001720081',
    RH:  '395368000001722146',
    RU:  '395368000000189264',   // Billing - RU - SRET
  } as const,

  // Days of inactivity (since last_modified_time) before a bill is stalled
  STALL_DAYS: 21,
  // Push-list inclusion thresholds
  PUSH_LIST_MAX:      10,
  PUSH_MIN_AGE_DAYS:  24,
  PUSH_MIN_CLAIMED:   100_000,   // ₹1,00,000

  // Stage classification (confirmed against the live SRA billing blueprint).
  // "Internal / in our court" is derived dynamically = any live bill that is
  // neither at Trust nor closed — so we never hardcode the internal stage
  // names (they can change in the blueprint without breaking the card).
  TRUST_STAGE: 'Submitted to Trust A/c',
  DONE_STAGE:  'Payment Done',
  // How many distinct internal stages to show as bars (rest lumped as "Other")
  MAX_STAGE_BARS: 6,

  // wo_po_no values that mean "no work order attached"
  NO_WO_VALUES: ['Pending', 'Without WO', 'Without WO/PO', '0', ''] as const,

  // Storage
  BUCKET:           'bills-pipeline',
  KEEP_FILES:       12,
  APP_SETTINGS_KEY: 'bills_pipeline_last',

  // Zoho Projects API v3 (India DC). Tasks live at:
  //   /api/v3/portal/{portalId}/projects/{projectId}/tasks
  // Response shape: { status, data: { page_info: { has_next_page }, tasks[] } }
  ZOHO_TOKEN_URL: 'https://accounts.zoho.in/oauth/v2/token',
  ZOHO_API_BASE:  'https://projectsapi.zoho.in/api/v3',
  PAGE_SIZE:      200,

  // PNG card dimensions (portrait, 1080px wide)
  CARD_WIDTH: 1080,
  SECTION: {
    TITLE:       150,
    ACTION_BAND:  80,
    KPI_TILES:   130,
    BARS_HEADER:  56,   // title strip inside the bars card
    BARS_ROW:     38,   // per-stage bar row height
    BARS_PAD:     24,   // top+bottom padding of the bars card
    PUSH_HEADER:  40,
    PUSH_ROW:     40,
    FOOTER:       90,
  },
} as const
