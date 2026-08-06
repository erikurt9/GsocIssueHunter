import { NextResponse } from "next/server";
import { loadIssues } from "@/lib/load-issues";

export const runtime = "nodejs";

// Returns aggregate counts across the FULL issue set (not paginated), so the
// UI can show accurate totals and let people browse by org / repo / label.
export async function GET() {
  try {
    const { issues } = await loadIssues();

    const orgCounts = new Map<string, number>();
    const orgGsocOfficial = new Map<string, boolean>();
    const repoCounts = new Map<string, { org?: string; count: number }>();
    const labelCounts = new Map<string, number>();
    let gfiCount = 0;
    let gsocCount = 0;

    for (const i of issues) {
      const org = i.org || (i.repo ? i.repo.split("/")[0] : undefined);
      if (org) {
        orgCounts.set(org, (orgCounts.get(org) || 0) + 1);
        if (i.es_gsoc_oficial) orgGsocOfficial.set(org, true);
        else if (!orgGsocOfficial.has(org)) orgGsocOfficial.set(org, false);
      }

      if (i.repo) {
        const prev = repoCounts.get(i.repo);
        repoCounts.set(i.repo, { org, count: (prev?.count || 0) + 1 });
      }

      for (const l of i.labels || []) {
        if (!l) continue;
        labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
      }

      if (i.es_good_first_issue) gfiCount++;
      if (i.es_gsoc_oficial) gsocCount++;
    }

    const orgs = [...orgCounts.entries()]
      .map(([name, count]) => ({ name, count, gsocOfficial: !!orgGsocOfficial.get(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const repos = [...repoCounts.entries()]
      .map(([name, v]) => ({ name, org: v.org, count: v.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const labels = [...labelCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return NextResponse.json({
      totalIssues: issues.length,
      gfiCount,
      gsocCount,
      orgs,
      repos,
      labels,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
