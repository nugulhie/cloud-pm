"use client";
import {
  usePlanningData,
  usePlanningAction,
  type PlanningApi,
} from "./planning-hooks";
export default function NotificationPreferences({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const api: PlanningApi = async (path, body) => {
    const r = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "알림 설정 요청 실패");
    return data;
  };
  const query = usePlanningData<{
      data: {
        due: boolean;
        assignments: boolean;
        daily: boolean;
        weekly: boolean;
      };
      revision: number;
    }>(api, "workflow/notification-settings"),
    action = usePlanningAction(api, async () => {
      query.reload();
    });
  return (
    <section>
      <h3>업무 알림 설정</h3>
      <p className="muted">
        앱 내 알림함으로 전달합니다. 일일 요약은 오전 9시 이후, 주간 점검은
        월요일 오전 9시 이후 생성됩니다.
      </p>
      {(query.error || action.error) && (
        <p role="alert">{query.error || action.error}</p>
      )}
      {action.notice && <p role="status">{action.notice}</p>}
      {query.data && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await action.mutate(
              "workflow/notification-settings",
              {
                revision: query.data!.revision,
                due: f.has("due"),
                assignments: f.has("assignments"),
                daily: f.has("daily"),
                weekly: f.has("weekly"),
              },
              "알림 설정을 저장했습니다.",
            );
          }}
        >
          <fieldset disabled={action.busy}>
            {Object.entries({
              assignments: "담당자 변경 알림",
              due: "마감 임박·기한 초과 알림",
              daily: "일일 PM 요약",
              weekly: "주간 업무 점검",
            }).map(([key, label]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={
                    query.data!.data[key as keyof typeof query.data.data]
                  }
                />
                {label}
              </label>
            ))}
            <p className="muted">
              멘션·댓글, 기획 검수와 차단 해제 알림은 계속 표시합니다.
            </p>
            <button className="button">알림 설정 저장</button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
