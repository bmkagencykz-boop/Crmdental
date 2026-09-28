import type { ApiRouteName } from "./manifest";

/**
 * Methods of the public API added in stage 25 (configuration of the clinic
 * by an integrator), in the order of the API docs page, with a curl example
 * each on the clinic's own address.
 */
export const CONFIG_ENDPOINTS: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  key: ApiRouteName;
}[] = [
  { method: "GET", path: "/account", key: "get_account" },
  { method: "POST", path: "/pipelines", key: "create_pipeline" },
  { method: "PATCH", path: "/pipelines/:id", key: "update_pipeline" },
  { method: "GET", path: "/stages", key: "list_stages" },
  { method: "POST", path: "/stages", key: "create_stage" },
  { method: "PATCH", path: "/stages/:id", key: "update_stage" },
  { method: "GET", path: "/stage_triggers", key: "list_stage_triggers" },
  { method: "POST", path: "/stage_triggers", key: "create_stage_trigger" },
  { method: "PATCH", path: "/stage_triggers/:id", key: "update_stage_trigger" },
  {
    method: "DELETE",
    path: "/stage_triggers/:id",
    key: "delete_stage_trigger",
  },
  { method: "GET", path: "/custom_fields", key: "list_custom_fields" },
  { method: "POST", path: "/custom_fields", key: "create_custom_field" },
  { method: "GET", path: "/tasks", key: "list_tasks" },
  { method: "POST", path: "/tasks", key: "create_task" },
  { method: "GET", path: "/messages", key: "list_messages" },
  { method: "POST", path: "/messages", key: "send_message" },
];

export const configCurlExamples = (
  baseUrl: string,
  key = "<API-ключ>",
): Partial<Record<ApiRouteName, string>> => {
  const auth = `-H "Authorization: Bearer ${key}"`;
  const json = `-H "Content-Type: application/json"`;
  return {
    get_account: `curl ${auth} "${baseUrl}/account"`,
    create_pipeline: `curl -X POST ${auth} ${json} "${baseUrl}/pipelines" \\\n  -d '{"name": "Ортодонтия", "stages": [{"name": "Заявка"}, {"name": "Консультация"}, {"name": "Лечение начато", "kind": "won"}, {"name": "Отказ", "kind": "lost"}]}'`,
    update_pipeline: `curl -X PATCH ${auth} ${json} "${baseUrl}/pipelines/4" \\\n  -d '{"name": "Ортодонтия (брекеты и элайнеры)", "position": 1}'`,
    list_stages: `curl ${auth} "${baseUrl}/stages?pipeline_id=4"`,
    create_stage: `curl -X POST ${auth} ${json} "${baseUrl}/stages" \\\n  -d '{"pipeline_id": 4, "name": "План лечения", "color": "#F47C9C"}'`,
    update_stage: `curl -X PATCH ${auth} ${json} "${baseUrl}/stages/17" \\\n  -d '{"name": "План согласован", "script": "Уточните удобное время первого визита"}'`,
    list_stage_triggers: `curl ${auth} "${baseUrl}/stage_triggers?pipeline_id=4"`,
    create_stage_trigger: `curl -X POST ${auth} ${json} "${baseUrl}/stage_triggers" \\\n  -d '{"stage_id": 15, "event": "message_in", "action": "move_stage", "target_stage_id": 16, "name": "Ответил — в работу"}'`,
    update_stage_trigger: `curl -X PATCH ${auth} ${json} "${baseUrl}/stage_triggers/9" \\\n  -d '{"is_active": false}'`,
    delete_stage_trigger: `curl -X DELETE ${auth} "${baseUrl}/stage_triggers/9"`,
    list_custom_fields: `curl ${auth} "${baseUrl}/custom_fields?entity=deal"`,
    create_custom_field: `curl -X POST ${auth} ${json} "${baseUrl}/custom_fields" \\\n  -d '{"entity": "deal", "name": "Рекламная кампания", "type": "select", "options": ["Instagram", "2GIS", "Сайт"]}'`,
    list_tasks: `curl ${auth} "${baseUrl}/tasks?deal_id=123&done=false"`,
    create_task: `curl -X POST ${auth} ${json} "${baseUrl}/tasks" \\\n  -d '{"deal_id": 123, "type": "call", "text": "Перезвонить после консультации", "due_date": "2026-10-15T11:00:00+05:00"}'`,
    list_messages: `curl ${auth} "${baseUrl}/messages?deal_id=123"`,
    send_message: `curl -X POST ${auth} ${json} "${baseUrl}/messages" \\\n  -d '{"deal_id": 123, "text": "Асель, напоминаем о визите завтра в 10:30"}'`,
  };
};
