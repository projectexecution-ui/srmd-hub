-- Rollback for 20260905_policy_merge.sql: recreates every policy that
-- migration dropped, exactly as pg_policies held it on 5 Sept 2026.
-- Run the DROP POLICY lines first (they remove the merged policies), then the
-- CREATE POLICY lines.

drop policy if exists "allowed_emails_select_merged" on public."allowed_emails";
drop policy if exists "allowed_emails_insert_merged" on public."allowed_emails";
drop policy if exists "allowed_emails_update_merged" on public."allowed_emails";
drop policy if exists "allowed_emails_delete_merged" on public."allowed_emails";
drop policy if exists "app_settings_select_merged" on public."app_settings";
drop policy if exists "app_settings_insert_merged" on public."app_settings";
drop policy if exists "app_settings_update_merged" on public."app_settings";
drop policy if exists "approval_rules_select_merged" on public."approval_rules";
drop policy if exists "approval_rules_insert_merged" on public."approval_rules";
drop policy if exists "approval_rules_update_merged" on public."approval_rules";
drop policy if exists "approval_rules_delete_merged" on public."approval_rules";
drop policy if exists "approval_stages_select_merged" on public."approval_stages";
drop policy if exists "approval_stages_insert_merged" on public."approval_stages";
drop policy if exists "approval_stages_update_merged" on public."approval_stages";
drop policy if exists "approval_stages_delete_merged" on public."approval_stages";
drop policy if exists "blueprint_demo_requests_select_merged" on public."blueprint_demo_requests";
drop policy if exists "blueprint_demo_requests_insert_merged" on public."blueprint_demo_requests";
drop policy if exists "blueprint_demo_requests_update_merged" on public."blueprint_demo_requests";
drop policy if exists "blueprint_demo_requests_delete_merged" on public."blueprint_demo_requests";
drop policy if exists "budget_v2_alias_select_merged" on public."budget_v2_alias";
drop policy if exists "budget_v2_alias_insert_merged" on public."budget_v2_alias";
drop policy if exists "budget_v2_alias_update_merged" on public."budget_v2_alias";
drop policy if exists "budget_v2_alias_delete_merged" on public."budget_v2_alias";
drop policy if exists "budget_v2_extra_project_select_merged" on public."budget_v2_extra_project";
drop policy if exists "budget_v2_extra_project_insert_merged" on public."budget_v2_extra_project";
drop policy if exists "budget_v2_extra_project_update_merged" on public."budget_v2_extra_project";
drop policy if exists "budget_v2_extra_project_delete_merged" on public."budget_v2_extra_project";
drop policy if exists "budget_v2_override_select_merged" on public."budget_v2_override";
drop policy if exists "budget_v2_override_insert_merged" on public."budget_v2_override";
drop policy if exists "budget_v2_override_update_merged" on public."budget_v2_override";
drop policy if exists "budget_v2_override_delete_merged" on public."budget_v2_override";
drop policy if exists "budget_v2_project_area_select_merged" on public."budget_v2_project_area";
drop policy if exists "budget_v2_project_area_insert_merged" on public."budget_v2_project_area";
drop policy if exists "budget_v2_project_area_update_merged" on public."budget_v2_project_area";
drop policy if exists "budget_v2_project_area_delete_merged" on public."budget_v2_project_area";
drop policy if exists "budget_v2_project_status_select_merged" on public."budget_v2_project_status";
drop policy if exists "budget_v2_project_status_insert_merged" on public."budget_v2_project_status";
drop policy if exists "budget_v2_project_status_update_merged" on public."budget_v2_project_status";
drop policy if exists "budget_v2_project_status_delete_merged" on public."budget_v2_project_status";
drop policy if exists "budget_v2_weekly_snapshot_select_merged" on public."budget_v2_weekly_snapshot";
drop policy if exists "budget_v2_weekly_snapshot_insert_merged" on public."budget_v2_weekly_snapshot";
drop policy if exists "budget_v2_weekly_snapshot_update_merged" on public."budget_v2_weekly_snapshot";
drop policy if exists "budget_v2_weekly_snapshot_delete_merged" on public."budget_v2_weekly_snapshot";
drop policy if exists "cc_approval_thresholds_select_merged" on public."cc_approval_thresholds";
drop policy if exists "cc_approval_thresholds_insert_merged" on public."cc_approval_thresholds";
drop policy if exists "cc_approval_thresholds_update_merged" on public."cc_approval_thresholds";
drop policy if exists "cc_approval_thresholds_delete_merged" on public."cc_approval_thresholds";
drop policy if exists "cc_bills_select_merged" on public."cc_bills";
drop policy if exists "cc_bills_insert_merged" on public."cc_bills";
drop policy if exists "cc_bills_update_merged" on public."cc_bills";
drop policy if exists "cc_bills_delete_merged" on public."cc_bills";
drop policy if exists "cc_budget_lines_select_merged" on public."cc_budget_lines";
drop policy if exists "cc_budget_lines_insert_merged" on public."cc_budget_lines";
drop policy if exists "cc_budget_lines_update_merged" on public."cc_budget_lines";
drop policy if exists "cc_budget_lines_delete_merged" on public."cc_budget_lines";
drop policy if exists "cc_discipline_approvers_select_merged" on public."cc_discipline_approvers";
drop policy if exists "cc_discipline_approvers_insert_merged" on public."cc_discipline_approvers";
drop policy if exists "cc_discipline_approvers_update_merged" on public."cc_discipline_approvers";
drop policy if exists "cc_discipline_approvers_delete_merged" on public."cc_discipline_approvers";
drop policy if exists "cc_disciplines_select_merged" on public."cc_disciplines";
drop policy if exists "cc_disciplines_insert_merged" on public."cc_disciplines";
drop policy if exists "cc_disciplines_update_merged" on public."cc_disciplines";
drop policy if exists "cc_disciplines_delete_merged" on public."cc_disciplines";
drop policy if exists "cc_excel_imports_select_merged" on public."cc_excel_imports";
drop policy if exists "cc_excel_imports_insert_merged" on public."cc_excel_imports";
drop policy if exists "cc_excel_imports_update_merged" on public."cc_excel_imports";
drop policy if exists "cc_excel_imports_delete_merged" on public."cc_excel_imports";
drop policy if exists "cc_excel_rows_select_merged" on public."cc_excel_rows";
drop policy if exists "cc_excel_rows_insert_merged" on public."cc_excel_rows";
drop policy if exists "cc_excel_rows_update_merged" on public."cc_excel_rows";
drop policy if exists "cc_excel_rows_delete_merged" on public."cc_excel_rows";
drop policy if exists "cc_notification_rules_select_merged" on public."cc_notification_rules";
drop policy if exists "cc_notification_rules_insert_merged" on public."cc_notification_rules";
drop policy if exists "cc_notification_rules_update_merged" on public."cc_notification_rules";
drop policy if exists "cc_notification_rules_delete_merged" on public."cc_notification_rules";
drop policy if exists "cc_payments_select_merged" on public."cc_payments";
drop policy if exists "cc_payments_insert_merged" on public."cc_payments";
drop policy if exists "cc_payments_update_merged" on public."cc_payments";
drop policy if exists "cc_payments_delete_merged" on public."cc_payments";
drop policy if exists "cc_project_disciplines_select_merged" on public."cc_project_disciplines";
drop policy if exists "cc_project_disciplines_insert_merged" on public."cc_project_disciplines";
drop policy if exists "cc_project_disciplines_update_merged" on public."cc_project_disciplines";
drop policy if exists "cc_project_disciplines_delete_merged" on public."cc_project_disciplines";
drop policy if exists "cc_project_sub_skills_select_merged" on public."cc_project_sub_skills";
drop policy if exists "cc_project_sub_skills_insert_merged" on public."cc_project_sub_skills";
drop policy if exists "cc_project_sub_skills_update_merged" on public."cc_project_sub_skills";
drop policy if exists "cc_project_sub_skills_delete_merged" on public."cc_project_sub_skills";
drop policy if exists "cc_qty_templates_select_merged" on public."cc_qty_templates";
drop policy if exists "cc_qty_templates_insert_merged" on public."cc_qty_templates";
drop policy if exists "cc_qty_templates_update_merged" on public."cc_qty_templates";
drop policy if exists "cc_qty_templates_delete_merged" on public."cc_qty_templates";
drop policy if exists "cc_sub_skills_select_merged" on public."cc_sub_skills";
drop policy if exists "cc_sub_skills_insert_merged" on public."cc_sub_skills";
drop policy if exists "cc_sub_skills_update_merged" on public."cc_sub_skills";
drop policy if exists "cc_sub_skills_delete_merged" on public."cc_sub_skills";
drop policy if exists "cc_working_sheet_items_select_merged" on public."cc_working_sheet_items";
drop policy if exists "cc_working_sheet_items_insert_merged" on public."cc_working_sheet_items";
drop policy if exists "cc_working_sheet_items_update_merged" on public."cc_working_sheet_items";
drop policy if exists "cc_working_sheet_items_delete_merged" on public."cc_working_sheet_items";
drop policy if exists "cc_ws_item_qty_rows_select_merged" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_ws_item_qty_rows_insert_merged" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_ws_item_qty_rows_update_merged" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_ws_item_qty_rows_delete_merged" on public."cc_ws_item_qty_rows";
drop policy if exists "cc_ws_item_qty_sections_select_merged" on public."cc_ws_item_qty_sections";
drop policy if exists "cc_ws_item_qty_sections_insert_merged" on public."cc_ws_item_qty_sections";
drop policy if exists "cc_ws_item_qty_sections_update_merged" on public."cc_ws_item_qty_sections";
drop policy if exists "cc_ws_item_qty_sections_delete_merged" on public."cc_ws_item_qty_sections";
drop policy if exists "cmp_comparisons_select_merged" on public."cmp_comparisons";
drop policy if exists "cmp_comparisons_insert_merged" on public."cmp_comparisons";
drop policy if exists "cmp_comparisons_update_merged" on public."cmp_comparisons";
drop policy if exists "cmp_comparisons_delete_merged" on public."cmp_comparisons";
drop policy if exists "cmp_items_select_merged" on public."cmp_items";
drop policy if exists "cmp_items_insert_merged" on public."cmp_items";
drop policy if exists "cmp_items_update_merged" on public."cmp_items";
drop policy if exists "cmp_items_delete_merged" on public."cmp_items";
drop policy if exists "cmp_quotes_select_merged" on public."cmp_quotes";
drop policy if exists "cmp_quotes_insert_merged" on public."cmp_quotes";
drop policy if exists "cmp_quotes_update_merged" on public."cmp_quotes";
drop policy if exists "cmp_quotes_delete_merged" on public."cmp_quotes";
drop policy if exists "cmp_vendors_select_merged" on public."cmp_vendors";
drop policy if exists "cmp_vendors_insert_merged" on public."cmp_vendors";
drop policy if exists "cmp_vendors_update_merged" on public."cmp_vendors";
drop policy if exists "cmp_vendors_delete_merged" on public."cmp_vendors";
drop policy if exists "dsr_tracking_select_merged" on public."dsr_tracking";
drop policy if exists "dsr_tracking_insert_merged" on public."dsr_tracking";
drop policy if exists "dsr_tracking_update_merged" on public."dsr_tracking";
drop policy if exists "dsr_tracking_delete_merged" on public."dsr_tracking";
drop policy if exists "est_categories_select_merged" on public."est_categories";
drop policy if exists "est_categories_insert_merged" on public."est_categories";
drop policy if exists "est_categories_update_merged" on public."est_categories";
drop policy if exists "est_categories_delete_merged" on public."est_categories";
drop policy if exists "est_disciplines_select_merged" on public."est_disciplines";
drop policy if exists "est_disciplines_insert_merged" on public."est_disciplines";
drop policy if exists "est_disciplines_update_merged" on public."est_disciplines";
drop policy if exists "est_disciplines_delete_merged" on public."est_disciplines";
drop policy if exists "est_rates_select_merged" on public."est_rates";
drop policy if exists "est_rates_insert_merged" on public."est_rates";
drop policy if exists "est_rates_update_merged" on public."est_rates";
drop policy if exists "est_rates_delete_merged" on public."est_rates";
drop policy if exists "est_subcategories_select_merged" on public."est_subcategories";
drop policy if exists "est_subcategories_insert_merged" on public."est_subcategories";
drop policy if exists "est_subcategories_update_merged" on public."est_subcategories";
drop policy if exists "est_subcategories_delete_merged" on public."est_subcategories";
drop policy if exists "est_upload_log_select_merged" on public."est_upload_log";
drop policy if exists "est_upload_log_insert_merged" on public."est_upload_log";
drop policy if exists "est_upload_log_update_merged" on public."est_upload_log";
drop policy if exists "est_upload_log_delete_merged" on public."est_upload_log";
drop policy if exists "est_wo_history_select_merged" on public."est_wo_history";
drop policy if exists "est_wo_history_insert_merged" on public."est_wo_history";
drop policy if exists "est_wo_history_update_merged" on public."est_wo_history";
drop policy if exists "est_wo_history_delete_merged" on public."est_wo_history";
drop policy if exists "in4_subproject_links_select_merged" on public."in4_subproject_links";
drop policy if exists "in4_subproject_links_insert_merged" on public."in4_subproject_links";
drop policy if exists "in4_subproject_links_update_merged" on public."in4_subproject_links";
drop policy if exists "in4_subproject_links_delete_merged" on public."in4_subproject_links";
drop policy if exists "inv_engineer_projects_select_merged" on public."inv_engineer_projects";
drop policy if exists "inv_engineer_projects_insert_merged" on public."inv_engineer_projects";
drop policy if exists "inv_engineer_projects_update_merged" on public."inv_engineer_projects";
drop policy if exists "inv_engineer_projects_delete_merged" on public."inv_engineer_projects";
drop policy if exists "inv_items_select_merged" on public."inv_items";
drop policy if exists "inv_items_insert_merged" on public."inv_items";
drop policy if exists "inv_items_update_merged" on public."inv_items";
drop policy if exists "inv_items_delete_merged" on public."inv_items";
drop policy if exists "inv_project_setup_select_merged" on public."inv_project_setup";
drop policy if exists "inv_project_setup_insert_merged" on public."inv_project_setup";
drop policy if exists "inv_project_setup_update_merged" on public."inv_project_setup";
drop policy if exists "inv_project_setup_delete_merged" on public."inv_project_setup";
drop policy if exists "inv_request_items_select_merged" on public."inv_request_items";
drop policy if exists "inv_request_items_insert_merged" on public."inv_request_items";
drop policy if exists "inv_request_items_update_merged" on public."inv_request_items";
drop policy if exists "inv_request_items_delete_merged" on public."inv_request_items";
drop policy if exists "inv_request_status_log_select_merged" on public."inv_request_status_log";
drop policy if exists "inv_request_status_log_insert_merged" on public."inv_request_status_log";
drop policy if exists "inv_request_status_log_update_merged" on public."inv_request_status_log";
drop policy if exists "inv_request_status_log_delete_merged" on public."inv_request_status_log";
drop policy if exists "inv_requests_select_merged" on public."inv_requests";
drop policy if exists "inv_requests_insert_merged" on public."inv_requests";
drop policy if exists "inv_requests_update_merged" on public."inv_requests";
drop policy if exists "inv_requests_delete_merged" on public."inv_requests";
drop policy if exists "inv_returns_select_merged" on public."inv_returns";
drop policy if exists "inv_returns_insert_merged" on public."inv_returns";
drop policy if exists "inv_returns_update_merged" on public."inv_returns";
drop policy if exists "inv_returns_delete_merged" on public."inv_returns";
drop policy if exists "inv_stock_select_merged" on public."inv_stock";
drop policy if exists "inv_stock_insert_merged" on public."inv_stock";
drop policy if exists "inv_stock_update_merged" on public."inv_stock";
drop policy if exists "inv_stock_delete_merged" on public."inv_stock";
drop policy if exists "inv_stock_movements_select_merged" on public."inv_stock_movements";
drop policy if exists "inv_stock_movements_insert_merged" on public."inv_stock_movements";
drop policy if exists "inv_stock_movements_update_merged" on public."inv_stock_movements";
drop policy if exists "inv_stock_movements_delete_merged" on public."inv_stock_movements";
drop policy if exists "inv_warehouses_select_merged" on public."inv_warehouses";
drop policy if exists "inv_warehouses_insert_merged" on public."inv_warehouses";
drop policy if exists "inv_warehouses_update_merged" on public."inv_warehouses";
drop policy if exists "inv_warehouses_delete_merged" on public."inv_warehouses";
drop policy if exists "jmr_contractors_select_merged" on public."jmr_contractors";
drop policy if exists "jmr_contractors_insert_merged" on public."jmr_contractors";
drop policy if exists "jmr_contractors_update_merged" on public."jmr_contractors";
drop policy if exists "jmr_contractors_delete_merged" on public."jmr_contractors";
drop policy if exists "jmr_user_project_access_select_merged" on public."jmr_user_project_access";
drop policy if exists "jmr_user_project_access_insert_merged" on public."jmr_user_project_access";
drop policy if exists "jmr_user_project_access_update_merged" on public."jmr_user_project_access";
drop policy if exists "jmr_user_project_access_delete_merged" on public."jmr_user_project_access";
drop policy if exists "master_links_select_merged" on public."master_links";
drop policy if exists "master_links_insert_merged" on public."master_links";
drop policy if exists "master_links_update_merged" on public."master_links";
drop policy if exists "master_links_delete_merged" on public."master_links";
drop policy if exists "module_labels_select_merged" on public."module_labels";
drop policy if exists "module_labels_insert_merged" on public."module_labels";
drop policy if exists "module_labels_update_merged" on public."module_labels";
drop policy if exists "module_labels_delete_merged" on public."module_labels";
drop policy if exists "module_visibility_select_merged" on public."module_visibility";
drop policy if exists "module_visibility_insert_merged" on public."module_visibility";
drop policy if exists "module_visibility_update_merged" on public."module_visibility";
drop policy if exists "module_visibility_delete_merged" on public."module_visibility";
drop policy if exists "notification_rules_select_merged" on public."notification_rules";
drop policy if exists "notification_rules_insert_merged" on public."notification_rules";
drop policy if exists "notification_rules_update_merged" on public."notification_rules";
drop policy if exists "notification_rules_delete_merged" on public."notification_rules";
drop policy if exists "notification_schedule_select_merged_public" on public."notification_schedule";
drop policy if exists "notification_schedule_insert_merged_public" on public."notification_schedule";
drop policy if exists "notification_schedule_update_merged_public" on public."notification_schedule";
drop policy if exists "notification_schedule_delete_merged_public" on public."notification_schedule";
drop policy if exists "notification_self_manage_select_merged_public" on public."notification_self_manage";
drop policy if exists "notification_self_manage_insert_merged_public" on public."notification_self_manage";
drop policy if exists "notification_self_manage_update_merged_public" on public."notification_self_manage";
drop policy if exists "notification_self_manage_delete_merged_public" on public."notification_self_manage";
drop policy if exists "permission_policies_select_merged" on public."permission_policies";
drop policy if exists "permission_policies_insert_merged" on public."permission_policies";
drop policy if exists "permission_policies_update_merged" on public."permission_policies";
drop policy if exists "permission_policies_delete_merged" on public."permission_policies";
drop policy if exists "procurement_tracker_state_select_merged" on public."procurement_tracker_state";
drop policy if exists "procurement_tracker_state_insert_merged" on public."procurement_tracker_state";
drop policy if exists "procurement_tracker_state_update_merged" on public."procurement_tracker_state";
drop policy if exists "procurement_tracker_state_delete_merged" on public."procurement_tracker_state";
drop policy if exists "procurement_user_project_visibility_select_merged" on public."procurement_user_project_visibility";
drop policy if exists "procurement_user_project_visibility_insert_merged" on public."procurement_user_project_visibility";
drop policy if exists "procurement_user_project_visibility_update_merged" on public."procurement_user_project_visibility";
drop policy if exists "procurement_user_project_visibility_delete_merged" on public."procurement_user_project_visibility";
drop policy if exists "project_aliases_select_merged" on public."project_aliases";
drop policy if exists "project_aliases_insert_merged" on public."project_aliases";
drop policy if exists "project_aliases_update_merged" on public."project_aliases";
drop policy if exists "project_aliases_delete_merged" on public."project_aliases";
drop policy if exists "project_assignments_select_merged" on public."project_assignments";
drop policy if exists "project_assignments_insert_merged" on public."project_assignments";
drop policy if exists "project_assignments_update_merged" on public."project_assignments";
drop policy if exists "project_assignments_delete_merged" on public."project_assignments";
drop policy if exists "project_floors_select_merged" on public."project_floors";
drop policy if exists "project_floors_insert_merged" on public."project_floors";
drop policy if exists "project_floors_update_merged" on public."project_floors";
drop policy if exists "project_floors_delete_merged" on public."project_floors";
drop policy if exists "role_permissions_select_merged" on public."role_permissions";
drop policy if exists "role_permissions_insert_merged" on public."role_permissions";
drop policy if exists "role_permissions_update_merged" on public."role_permissions";
drop policy if exists "role_permissions_delete_merged" on public."role_permissions";
drop policy if exists "sched_drawing_revisions_select_merged" on public."sched_drawing_revisions";
drop policy if exists "sched_drawing_revisions_insert_merged" on public."sched_drawing_revisions";
drop policy if exists "sched_drawing_revisions_update_merged" on public."sched_drawing_revisions";
drop policy if exists "sched_drawing_revisions_delete_merged" on public."sched_drawing_revisions";
drop policy if exists "sched_drawings_select_merged" on public."sched_drawings";
drop policy if exists "sched_drawings_insert_merged" on public."sched_drawings";
drop policy if exists "sched_drawings_update_merged" on public."sched_drawings";
drop policy if exists "sched_drawings_delete_merged" on public."sched_drawings";
drop policy if exists "sched_progress_select_merged" on public."sched_progress";
drop policy if exists "sched_progress_insert_merged" on public."sched_progress";
drop policy if exists "sched_progress_update_merged" on public."sched_progress";
drop policy if exists "sched_progress_delete_merged" on public."sched_progress";
drop policy if exists "sched_promises_select_merged_public" on public."sched_promises";
drop policy if exists "sched_promises_insert_merged_public" on public."sched_promises";
drop policy if exists "sched_promises_update_merged_public" on public."sched_promises";
drop policy if exists "sched_promises_delete_merged_public" on public."sched_promises";
drop policy if exists "user_module_blocks_select_merged" on public."user_module_blocks";
drop policy if exists "user_module_blocks_insert_merged" on public."user_module_blocks";
drop policy if exists "user_module_blocks_update_merged" on public."user_module_blocks";
drop policy if exists "user_module_blocks_delete_merged" on public."user_module_blocks";
drop policy if exists "user_module_roles_select_merged" on public."user_module_roles";
drop policy if exists "user_module_roles_insert_merged" on public."user_module_roles";
drop policy if exists "user_module_roles_update_merged" on public."user_module_roles";
drop policy if exists "user_module_roles_delete_merged" on public."user_module_roles";
drop policy if exists "user_permission_overrides_select_merged" on public."user_permission_overrides";
drop policy if exists "user_permission_overrides_insert_merged" on public."user_permission_overrides";
drop policy if exists "user_permission_overrides_update_merged" on public."user_permission_overrides";
drop policy if exists "user_permission_overrides_delete_merged" on public."user_permission_overrides";
drop policy if exists "wh_count_lines_select_merged_public" on public."wh_count_lines";
drop policy if exists "wh_count_lines_insert_merged_public" on public."wh_count_lines";
drop policy if exists "wh_count_lines_update_merged_public" on public."wh_count_lines";
drop policy if exists "wh_count_lines_delete_merged_public" on public."wh_count_lines";
drop policy if exists "wh_counts_select_merged_public" on public."wh_counts";
drop policy if exists "wh_counts_insert_merged_public" on public."wh_counts";
drop policy if exists "wh_counts_update_merged_public" on public."wh_counts";
drop policy if exists "wh_counts_delete_merged_public" on public."wh_counts";
drop policy if exists "wh_gate_in_select_merged_public" on public."wh_gate_in";
drop policy if exists "wh_gate_in_insert_merged_public" on public."wh_gate_in";
drop policy if exists "wh_gate_in_update_merged_public" on public."wh_gate_in";
drop policy if exists "wh_gate_in_delete_merged_public" on public."wh_gate_in";
drop policy if exists "wh_gate_in_lines_select_merged_public" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_insert_merged_public" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_update_merged_public" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_in_lines_delete_merged_public" on public."wh_gate_in_lines";
drop policy if exists "wh_gate_out_select_merged_public" on public."wh_gate_out";
drop policy if exists "wh_gate_out_insert_merged_public" on public."wh_gate_out";
drop policy if exists "wh_gate_out_update_merged_public" on public."wh_gate_out";
drop policy if exists "wh_gate_out_delete_merged_public" on public."wh_gate_out";
drop policy if exists "wh_gate_out_lines_select_merged_public" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_insert_merged_public" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_update_merged_public" on public."wh_gate_out_lines";
drop policy if exists "wh_gate_out_lines_delete_merged_public" on public."wh_gate_out_lines";
drop policy if exists "wh_items_select_merged_public" on public."wh_items";
drop policy if exists "wh_items_insert_merged_public" on public."wh_items";
drop policy if exists "wh_items_update_merged_public" on public."wh_items";
drop policy if exists "wh_items_delete_merged_public" on public."wh_items";
drop policy if exists "wh_lists_select_merged_public" on public."wh_lists";
drop policy if exists "wh_lists_insert_merged_public" on public."wh_lists";
drop policy if exists "wh_lists_update_merged_public" on public."wh_lists";
drop policy if exists "wh_lists_delete_merged_public" on public."wh_lists";
drop policy if exists "wh_locations_select_merged_public" on public."wh_locations";
drop policy if exists "wh_locations_insert_merged_public" on public."wh_locations";
drop policy if exists "wh_locations_update_merged_public" on public."wh_locations";
drop policy if exists "wh_locations_delete_merged_public" on public."wh_locations";
drop policy if exists "wh_movements_select_merged_public" on public."wh_movements";
drop policy if exists "wh_movements_insert_merged_public" on public."wh_movements";
drop policy if exists "wh_movements_update_merged_public" on public."wh_movements";
drop policy if exists "wh_movements_delete_merged_public" on public."wh_movements";
drop policy if exists "wh_number_series_select_merged_public" on public."wh_number_series";
drop policy if exists "wh_number_series_insert_merged_public" on public."wh_number_series";
drop policy if exists "wh_number_series_update_merged_public" on public."wh_number_series";
drop policy if exists "wh_number_series_delete_merged_public" on public."wh_number_series";
drop policy if exists "wh_po_select_merged_public" on public."wh_po";
drop policy if exists "wh_po_insert_merged_public" on public."wh_po";
drop policy if exists "wh_po_update_merged_public" on public."wh_po";
drop policy if exists "wh_po_delete_merged_public" on public."wh_po";
drop policy if exists "wh_po_lines_select_merged_public" on public."wh_po_lines";
drop policy if exists "wh_po_lines_insert_merged_public" on public."wh_po_lines";
drop policy if exists "wh_po_lines_update_merged_public" on public."wh_po_lines";
drop policy if exists "wh_po_lines_delete_merged_public" on public."wh_po_lines";
drop policy if exists "wh_request_lines_select_merged_public" on public."wh_request_lines";
drop policy if exists "wh_request_lines_insert_merged_public" on public."wh_request_lines";
drop policy if exists "wh_request_lines_update_merged_public" on public."wh_request_lines";
drop policy if exists "wh_request_lines_delete_merged_public" on public."wh_request_lines";
drop policy if exists "wh_requests_select_merged_public" on public."wh_requests";
drop policy if exists "wh_requests_insert_merged_public" on public."wh_requests";
drop policy if exists "wh_requests_update_merged_public" on public."wh_requests";
drop policy if exists "wh_requests_delete_merged_public" on public."wh_requests";
drop policy if exists "wh_stock_select_merged_public" on public."wh_stock";
drop policy if exists "wh_stock_insert_merged_public" on public."wh_stock";
drop policy if exists "wh_stock_update_merged_public" on public."wh_stock";
drop policy if exists "wh_stock_delete_merged_public" on public."wh_stock";

-- ── allowed_emails ──
create policy "allowed_emails_read" on public."allowed_emails" as permissive for select to authenticated
  using (((email = lower(( SELECT profiles.email
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "allowed_emails_write" on public."allowed_emails" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))));
-- ── app_settings ──
create policy "admin can insert app_settings" on public."app_settings" as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (((p.role)::text = 'admin'::text) OR (p.is_portal_owner = true))))));
create policy "admin can update app_settings" on public."app_settings" as permissive for update to authenticated
  using ((current_user_role() = 'admin'::user_role));
create policy "anyone can read app_settings" on public."app_settings" as permissive for select to authenticated
  using (true);
create policy "portal owner can update app_settings" on public."app_settings" as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.is_portal_owner = true)))));
-- ── approval_rules ──
create policy "approval_rules_read" on public."approval_rules" as permissive for select to authenticated
  using (true);
create policy "approval_rules_write" on public."approval_rules" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── approval_stages ──
create policy "approval_stages_read" on public."approval_stages" as permissive for select to authenticated
  using (true);
create policy "approval_stages_write" on public."approval_stages" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))));
-- ── blueprint_demo_requests ──
create policy "bd_req_read" on public."blueprint_demo_requests" as permissive for select to authenticated
  using (true);
create policy "bd_req_write" on public."blueprint_demo_requests" as permissive for all to authenticated
  using (true)
  with check (true);
-- ── budget_v2_alias ──
create policy "bv2_alias_read" on public."budget_v2_alias" as permissive for select to authenticated
  using (true);
create policy "bv2_alias_write" on public."budget_v2_alias" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── budget_v2_extra_project ──
create policy "bv2_extra_read" on public."budget_v2_extra_project" as permissive for select to authenticated
  using (true);
create policy "bv2_extra_write" on public."budget_v2_extra_project" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── budget_v2_override ──
create policy "bv2_override_read" on public."budget_v2_override" as permissive for select to authenticated
  using (true);
create policy "bv2_override_write" on public."budget_v2_override" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── budget_v2_project_area ──
create policy "bv2_area_read" on public."budget_v2_project_area" as permissive for select to authenticated
  using (true);
create policy "bv2_area_write" on public."budget_v2_project_area" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── budget_v2_project_status ──
create policy "bv2_status_read" on public."budget_v2_project_status" as permissive for select to authenticated
  using (true);
create policy "bv2_status_write" on public."budget_v2_project_status" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── budget_v2_weekly_snapshot ──
create policy "bv2_snap_read" on public."budget_v2_weekly_snapshot" as permissive for select to authenticated
  using (true);
create policy "bv2_snap_write" on public."budget_v2_weekly_snapshot" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
-- ── cc_approval_thresholds ──
create policy "cc_at_admin_write" on public."cc_approval_thresholds" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "cc_at_read" on public."cc_approval_thresholds" as permissive for select to authenticated
  using (true);
-- ── cc_bills ──
create policy "cc_bills_read" on public."cc_bills" as permissive for select to authenticated
  using (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id));
create policy "cc_bills_write" on public."cc_bills" as permissive for all to authenticated
  using (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id))
  with check (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id));
-- ── cc_budget_lines ──
create policy "cc_bl_admin_write" on public."cc_budget_lines" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "cc_bl_read" on public."cc_budget_lines" as permissive for select to authenticated
  using (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id));
-- ── cc_discipline_approvers ──
create policy "cc_da_admin_write" on public."cc_discipline_approvers" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "cc_da_read" on public."cc_discipline_approvers" as permissive for select to authenticated
  using (true);
-- ── cc_disciplines ──
create policy "cc_disciplines_admin_write" on public."cc_disciplines" as permissive for all to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))));
create policy "cc_disciplines_read" on public."cc_disciplines" as permissive for select to authenticated
  using (true);
-- ── cc_excel_imports ──
create policy "cc_ei_read" on public."cc_excel_imports" as permissive for select to authenticated
  using (((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
create policy "cc_ei_write" on public."cc_excel_imports" as permissive for all to authenticated
  using (((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)))
  with check (((project_id IS NULL) OR fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id)));
-- ── cc_excel_rows ──
create policy "cc_excel_rows_read" on public."cc_excel_rows" as permissive for select to authenticated
  using ((fn_cc_can_view(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))))));
create policy "cc_excel_rows_write" on public."cc_excel_rows" as permissive for all to authenticated
  using ((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))))))
  with check ((fn_cc_can_edit(( SELECT auth.uid() AS uid)) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_excel_rows.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))))));
-- ── cc_notification_rules ──
create policy "cc_nr_admin_write" on public."cc_notification_rules" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "cc_nr_read" on public."cc_notification_rules" as permissive for select to authenticated
  using (true);
-- ── cc_payments ──
create policy "cc_pay_read" on public."cc_payments" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id)))));
create policy "cc_pay_write" on public."cc_payments" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id)))))
  with check ((EXISTS ( SELECT 1
   FROM cc_bills b
  WHERE ((b.id = cc_payments.bill_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), b.project_id)))));
-- ── cc_project_disciplines ──
create policy "cc_proj_disc_read" on public."cc_project_disciplines" as permissive for select to authenticated
  using (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id));
create policy "cc_proj_disc_write" on public."cc_project_disciplines" as permissive for all to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid)))))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_disciplines.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid)))))));
-- ── cc_project_sub_skills ──
create policy "cc_proj_ss_read" on public."cc_project_sub_skills" as permissive for select to authenticated
  using (fn_cc_user_in_project(( SELECT auth.uid() AS uid), project_id));
create policy "cc_proj_ss_write" on public."cc_project_sub_skills" as permissive for all to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid)))))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = cc_project_sub_skills.project_id) AND (p.pm_user_id = ( SELECT auth.uid() AS uid)))))));
-- ── cc_qty_templates ──
create policy "cc_qt_admin_write" on public."cc_qty_templates" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "cc_qt_read" on public."cc_qty_templates" as permissive for select to authenticated
  using (((is_active = true) OR fn_cc_is_admin(( SELECT auth.uid() AS uid))));
-- ── cc_sub_skills ──
create policy "cc_sub_skills_admin_write" on public."cc_sub_skills" as permissive for all to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))));
create policy "cc_sub_skills_read" on public."cc_sub_skills" as permissive for select to authenticated
  using (true);
-- ── cc_working_sheet_items ──
create policy "cc_wsi_read" on public."cc_working_sheet_items" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))));
create policy "cc_wsi_write" on public."cc_working_sheet_items" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid)))))))
  with check ((EXISTS ( SELECT 1
   FROM cc_working_sheets ws
  WHERE ((ws.id = cc_working_sheet_items.working_sheet_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id) OR fn_cc_is_reviewer(( SELECT auth.uid() AS uid)))))));
-- ── cc_ws_item_qty_rows ──
create policy "cc_qr_read" on public."cc_ws_item_qty_rows" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))));
create policy "cc_qr_write" on public."cc_ws_item_qty_rows" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id))))))
  with check ((EXISTS ( SELECT 1
   FROM ((cc_ws_item_qty_sections s
     JOIN cc_working_sheet_items i ON ((i.id = s.working_sheet_item_id)))
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((s.id = cc_ws_item_qty_rows.section_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id))))));
-- ── cc_ws_item_qty_sections ──
create policy "cc_qs_read" on public."cc_ws_item_qty_sections" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND fn_cc_user_in_project(( SELECT auth.uid() AS uid), ws.project_id)))));
create policy "cc_qs_write" on public."cc_ws_item_qty_sections" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id))))))
  with check ((EXISTS ( SELECT 1
   FROM (cc_working_sheet_items i
     JOIN cc_working_sheets ws ON ((ws.id = i.working_sheet_id)))
  WHERE ((i.id = cc_ws_item_qty_sections.working_sheet_item_id) AND (fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR ((ws.engineer_id = ( SELECT auth.uid() AS uid)) AND (ws.status = 'draft'::cc_ws_status)) OR fn_cc_user_heads_discipline(( SELECT auth.uid() AS uid), ws.discipline_id))))));
-- ── cmp_comparisons ──
create policy "cmp_comparisons_read" on public."cmp_comparisons" as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "cmp_comparisons_write" on public."cmp_comparisons" as permissive for all to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
-- ── cmp_items ──
create policy "cmp_items_read" on public."cmp_items" as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "cmp_items_write" on public."cmp_items" as permissive for all to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
-- ── cmp_quotes ──
create policy "cmp_quotes_read" on public."cmp_quotes" as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "cmp_quotes_write" on public."cmp_quotes" as permissive for all to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
-- ── cmp_vendors ──
create policy "cmp_vendors_read" on public."cmp_vendors" as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_view = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "cmp_vendors_write" on public."cmp_vendors" as permissive for all to authenticated
  using (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))))
  with check (((EXISTS ( SELECT 1
   FROM role_permissions rp
  WHERE ((rp.module_slug = 'comparison'::text) AND (rp.can_edit = true) AND ((rp.role)::text = (effective_user_role(( SELECT auth.uid() AS uid), 'comparison'::text))::text)))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
-- ── dsr_tracking ──
create policy "dsr_tracking_select" on public."dsr_tracking" as permissive for select to authenticated
  using ((dsr_is_management() OR (EXISTS ( SELECT 1
   FROM dsr_reports r
  WHERE ((r.id = dsr_tracking.report_id) AND (r.created_by = ( SELECT auth.uid() AS uid)))))));
create policy "dsr_tracking_write" on public."dsr_tracking" as permissive for all to authenticated
  using (dsr_is_management())
  with check (dsr_is_management());
-- ── est_categories ──
create policy "est_categories_read" on public."est_categories" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_categories_write" on public."est_categories" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── est_disciplines ──
create policy "est_disciplines_read" on public."est_disciplines" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_disciplines_write" on public."est_disciplines" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── est_rates ──
create policy "est_rates_read" on public."est_rates" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_rates_write" on public."est_rates" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── est_subcategories ──
create policy "est_subcategories_read" on public."est_subcategories" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_subcategories_write" on public."est_subcategories" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── est_upload_log ──
create policy "est_upload_log_read" on public."est_upload_log" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_upload_log_write" on public."est_upload_log" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── est_wo_history ──
create policy "est_wo_history_read" on public."est_wo_history" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'established-rates'::text) AND (rp.can_view = true)))));
create policy "est_wo_history_write" on public."est_wo_history" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── in4_subproject_links ──
create policy "in4_subproject_links_admin_write" on public."in4_subproject_links" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
create policy "in4_subproject_links_read" on public."in4_subproject_links" as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
-- ── inv_engineer_projects ──
create policy "inv_engineer_projects_read" on public."inv_engineer_projects" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_engineer_projects_write_editor" on public."inv_engineer_projects" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_items ──
create policy "inv_items_read" on public."inv_items" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_items_write_editor" on public."inv_items" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_project_setup ──
create policy "inv_project_setup_read" on public."inv_project_setup" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_project_setup_write_editor" on public."inv_project_setup" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_request_items ──
create policy "inv_request_items_read" on public."inv_request_items" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_request_items_write_editor" on public."inv_request_items" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_request_status_log ──
create policy "inv_request_status_log_read" on public."inv_request_status_log" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_request_status_log_write_editor" on public."inv_request_status_log" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_requests ──
create policy "inv_requests_read" on public."inv_requests" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_requests_write_editor" on public."inv_requests" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_returns ──
create policy "inv_returns_read" on public."inv_returns" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_returns_write_editor" on public."inv_returns" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_stock ──
create policy "inv_stock_read" on public."inv_stock" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_stock_write_editor" on public."inv_stock" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_stock_movements ──
create policy "inv_stock_movements_read" on public."inv_stock_movements" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_stock_movements_write_editor" on public."inv_stock_movements" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── inv_warehouses ──
create policy "inv_warehouses_read" on public."inv_warehouses" as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_view = true)))));
create policy "inv_warehouses_write_editor" on public."inv_warehouses" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'inventory'::text) AND (rp.can_edit = true)))));
-- ── jmr_contractors ──
create policy "jmr_contractors_select" on public."jmr_contractors" as permissive for select to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role, 'founder'::user_role, 'uploader'::user_role, 'viewer'::user_role, 'engineer'::user_role, 'site_staff'::user_role])) OR ((jmr_user_role() = 'contractor'::user_role) AND (profile_id = ( SELECT auth.uid() AS uid)))));
create policy "jmr_contractors_write" on public."jmr_contractors" as permissive for all to authenticated
  using ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role])))
  with check ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role])));
-- ── jmr_user_project_access ──
create policy "jmr_upa_select" on public."jmr_user_project_access" as permissive for select to authenticated
  using (((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role, 'founder'::user_role])) OR (user_id = ( SELECT auth.uid() AS uid))));
create policy "jmr_upa_write" on public."jmr_user_project_access" as permissive for all to authenticated
  using ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role])))
  with check ((jmr_user_role() = ANY (ARRAY['admin'::user_role, 'head'::user_role])));
-- ── master_links ──
create policy "master_links_admin_write" on public."master_links" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
create policy "master_links_read" on public."master_links" as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
-- ── module_labels ──
create policy "module_labels_read" on public."module_labels" as permissive for select to authenticated
  using (true);
create policy "module_labels_write" on public."module_labels" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── module_visibility ──
create policy "module_visibility_select_all" on public."module_visibility" as permissive for select to authenticated
  using (true);
create policy "module_visibility_write_admin" on public."module_visibility" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.is_portal_owner = true) OR (p.role = 'admin'::user_role))))));
-- ── notification_rules ──
create policy "notification_rules_admin_write" on public."notification_rules" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
create policy "notification_rules_read" on public."notification_rules" as permissive for select to authenticated
  using (true);
-- ── notification_schedule ──
create policy "nsch_read" on public."notification_schedule" as permissive for select to public
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
create policy "nsch_write" on public."notification_schedule" as permissive for all to public
  using (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text))))
  with check (((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role) OR ((scope = 'user'::text) AND (scope_key = (( SELECT auth.uid() AS uid))::text))));
-- ── notification_self_manage ──
create policy "nsm_admin_write" on public."notification_self_manage" as permissive for all to public
  using ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role))
  with check ((( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role));
create policy "nsm_read" on public."notification_self_manage" as permissive for select to public
  using (((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT profiles.role
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid))) = 'admin'::user_role)));
-- ── permission_policies ──
create policy "pp_admin_write" on public."permission_policies" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "pp_read" on public."permission_policies" as permissive for select to authenticated
  using (true);
-- ── procurement_tracker_state ──
create policy "pts_select_all" on public."procurement_tracker_state" as permissive for select to authenticated
  using (true);
create policy "pts_write_writers" on public."procurement_tracker_state" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.role = 'uploader'::user_role))))));
-- ── procurement_user_project_visibility ──
create policy "pupv_select_own_or_admin" on public."procurement_user_project_visibility" as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role))))));
create policy "pupv_write_admin" on public."procurement_user_project_visibility" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.role = 'admin'::user_role)))));
-- ── project_aliases ──
create policy "project_aliases_admin_write" on public."project_aliases" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR p.is_portal_owner)))));
create policy "project_aliases_read" on public."project_aliases" as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) IS NOT NULL));
-- ── project_assignments ──
create policy "pa_admin_write" on public."project_assignments" as permissive for all to authenticated
  using ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))))
  with check ((fn_cc_is_admin(( SELECT auth.uid() AS uid)) OR fn_cc_can_admin(( SELECT auth.uid() AS uid))));
create policy "pa_read" on public."project_assignments" as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR fn_cc_is_admin(( SELECT auth.uid() AS uid))));
-- ── project_floors ──
create policy "project_floors_select_all" on public."project_floors" as permissive for select to authenticated
  using (true);
create policy "project_floors_write_editor" on public."project_floors" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true)))))
  with check ((EXISTS ( SELECT 1
   FROM role_permissions rp,
    profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (rp.role = p.role) AND (rp.module_slug = 'projects'::text) AND (rp.can_edit = true)))));
-- ── role_permissions ──
create policy "admin manages role_permissions" on public."role_permissions" as permissive for all to authenticated
  using ((current_user_role() = 'admin'::user_role))
  with check ((current_user_role() = 'admin'::user_role));
create policy "anyone authed reads role_permissions" on public."role_permissions" as permissive for select to authenticated
  using (true);
-- ── sched_drawing_revisions ──
create policy "sched_drawing_rev_select" on public."sched_drawing_revisions" as permissive for select to authenticated
  using (true);
create policy "sched_drawing_rev_write" on public."sched_drawing_revisions" as permissive for all to authenticated
  using (sched_can_write())
  with check (sched_can_write());
-- ── sched_drawings ──
create policy "sched_drawings_select" on public."sched_drawings" as permissive for select to authenticated
  using (true);
create policy "sched_drawings_write" on public."sched_drawings" as permissive for all to authenticated
  using (sched_can_write())
  with check (sched_can_write());
-- ── sched_progress ──
create policy "sched_progress_select" on public."sched_progress" as permissive for select to authenticated
  using (true);
create policy "sched_progress_write" on public."sched_progress" as permissive for all to authenticated
  using (sched_can_write())
  with check (sched_can_write());
-- ── sched_promises ──
create policy "sched_promises_select" on public."sched_promises" as permissive for select to public
  using (true);
create policy "sched_promises_write" on public."sched_promises" as permissive for all to public
  using (sched_can_write())
  with check (sched_can_write());
-- ── user_module_blocks ──
create policy "user_module_blocks_read" on public."user_module_blocks" as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "user_module_blocks_write" on public."user_module_blocks" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))));
-- ── user_module_roles ──
create policy "user_module_roles_read" on public."user_module_roles" as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true)))))));
create policy "user_module_roles_write" on public."user_module_roles" as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND ((p.role = 'admin'::user_role) OR (p.is_portal_owner = true))))));
-- ── user_permission_overrides ──
create policy "upo_admin_write" on public."user_permission_overrides" as permissive for all to authenticated
  using (fn_cc_is_admin(( SELECT auth.uid() AS uid)))
  with check (fn_cc_is_admin(( SELECT auth.uid() AS uid)));
create policy "upo_read" on public."user_permission_overrides" as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR fn_cc_is_admin(( SELECT auth.uid() AS uid))));
-- ── wh_count_lines ──
create policy "wh_count_lines_delete" on public."wh_count_lines" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_count_lines_read" on public."wh_count_lines" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_count_lines_write" on public."wh_count_lines" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_counts ──
create policy "wh_counts_delete" on public."wh_counts" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_counts_read" on public."wh_counts" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_counts_write" on public."wh_counts" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_gate_in ──
create policy "wh_gate_in_delete" on public."wh_gate_in" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_gate_in_read" on public."wh_gate_in" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_gate_in_write" on public."wh_gate_in" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_gate_in_lines ──
create policy "wh_gate_in_lines_delete" on public."wh_gate_in_lines" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_gate_in_lines_read" on public."wh_gate_in_lines" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_gate_in_lines_write" on public."wh_gate_in_lines" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_gate_out ──
create policy "wh_gate_out_delete" on public."wh_gate_out" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_gate_out_read" on public."wh_gate_out" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_gate_out_write" on public."wh_gate_out" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_gate_out_lines ──
create policy "wh_gate_out_lines_delete" on public."wh_gate_out_lines" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_gate_out_lines_read" on public."wh_gate_out_lines" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_gate_out_lines_write" on public."wh_gate_out_lines" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_items ──
create policy "wh_items_delete" on public."wh_items" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_items_read" on public."wh_items" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_items_write" on public."wh_items" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_lists ──
create policy "wh_lists_delete" on public."wh_lists" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_lists_read" on public."wh_lists" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_lists_write" on public."wh_lists" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_locations ──
create policy "wh_locations_delete" on public."wh_locations" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_locations_read" on public."wh_locations" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_locations_write" on public."wh_locations" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_movements ──
create policy "wh_movements_delete" on public."wh_movements" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_movements_read" on public."wh_movements" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_movements_write" on public."wh_movements" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_number_series ──
create policy "wh_number_series_delete" on public."wh_number_series" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_number_series_read" on public."wh_number_series" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_number_series_write" on public."wh_number_series" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_po ──
create policy "wh_po_delete" on public."wh_po" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_po_read" on public."wh_po" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_po_write" on public."wh_po" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_po_lines ──
create policy "wh_po_lines_delete" on public."wh_po_lines" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_po_lines_read" on public."wh_po_lines" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_po_lines_write" on public."wh_po_lines" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_request_lines ──
create policy "wh_request_lines_delete" on public."wh_request_lines" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_request_lines_read" on public."wh_request_lines" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_request_lines_write" on public."wh_request_lines" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_requests ──
create policy "wh_requests_delete" on public."wh_requests" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_requests_read" on public."wh_requests" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_requests_write" on public."wh_requests" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
-- ── wh_stock ──
create policy "wh_stock_delete" on public."wh_stock" as permissive for delete to public
  using (fn_wh_can('admin'::text));
create policy "wh_stock_read" on public."wh_stock" as permissive for select to public
  using (fn_wh_can('view'::text));
create policy "wh_stock_write" on public."wh_stock" as permissive for all to public
  using (fn_wh_can('edit'::text))
  with check (fn_wh_can('edit'::text));
