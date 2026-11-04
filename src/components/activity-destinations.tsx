import type { Service } from "../core/service";
type Data = Awaited<ReturnType<Service["dashboard"]>>;
export function activityDestinations(data: Data) {
  const tasks = new Map(data.tasks.map((t) => [t.data.id, t.data]));
  const projects = new Map(data.projects.map((p) => [p.data.id, p.data]));
  const result = new Map<
    string,
    Map<
      string,
      { project: string; feature: string; projectId: string; taskId: string }
    >
  >();
  for (const { data: link } of data.links) {
    if (link.status !== "approved") continue;
    const task = tasks.get(link.task);
    if (!task) continue;
    const project = projects.get(task.project);
    if (!project) continue;
    const placements = result.get(link.item) ?? new Map();
    placements.set(`${project.id}:${task.id}`, {
      project: project.name,
      feature: task.title,
      projectId: project.id,
      taskId: task.id,
    });
    result.set(link.item, placements);
  }
  return new Map(
    [...result].map(([id, placements]) => [id, [...placements.values()]]),
  );
}
export default function ActivityDestinations({
  destinations,
}: {
  destinations: { project: string; feature: string }[];
}) {
  return (
    <span
      className="activity-destinations"
      aria-label="연결된 프로젝트 및 작업"
    >
      {destinations.length ? (
        destinations.map((d, i) => (
          <span
            className="destination-badge"
            key={i}
            title={`${d.project} / ${d.feature}`}
          >
            <span className="destination-label">프로젝트</span> {d.project}
            <span aria-hidden="true"> / </span>
            <span className="destination-label">작업</span> {d.feature}
          </span>
        ))
      ) : (
        <span className="destination-empty">프로젝트 미연결</span>
      )}
    </span>
  );
}
