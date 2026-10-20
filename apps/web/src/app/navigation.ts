import {
  BarChart3,
  Bug,
  ClipboardCheck,
  Columns3,
  FileCode2,
  FolderKanban,
  GitBranch,
  ListChecks,
  ListTodo,
  Settings,
  Table2,
  Users,
  CalendarRange,
  Lightbulb,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

export interface NavModule {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Delivery phase in which the module is built (see docs/ARCHITECTURE.md). */
  phase: number;
  /** Implemented modules link to a real page; the rest show Coming Soon. */
  implemented: boolean;
  /** Path for implemented modules; project-scoped paths receive the current project id. */
  path?: (projectId: string | null) => string;
  summary: string;
}

export interface NavGroup {
  label: string;
  modules: NavModule[];
}

export const NAVIGATION: NavGroup[] = [
  {
    label: 'Product Design',
    modules: [
      {
        slug: 'process-designer',
        label: 'Process Designer',
        icon: GitBranch,
        phase: 1,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/processes` : '/projects'),
        summary: 'Describe business processes in natural language and turn them into interactive process maps.',
      },
      {
        slug: 'io-designer',
        label: 'Input & Output Designer',
        icon: Table2,
        phase: 2,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/data` : '/projects'),
        summary: 'Define the fields, validation rules and outputs of each process activity in a shared data dictionary.',
      },
      {
        slug: 'tech-user-stories',
        label: 'Tech User Story',
        icon: FileCode2,
        phase: 3,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/stories` : '/projects'),
        summary: 'Generate functional and technical implementation stories from approved processes and data requirements.',
      },
      {
        slug: 'business-user-stories',
        label: 'Business User Story',
        icon: ListChecks,
        phase: 5,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/scenarios` : '/projects'),
        summary: 'Generate end-to-end business scenarios for user acceptance testing.',
      },
    ],
  },
  {
    label: 'Delivery Management',
    modules: [
      {
        slug: 'backlog',
        label: 'Product Backlog',
        icon: ListTodo,
        phase: 4,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/backlog` : '/projects'),
        summary: 'Prioritise approved stories in a central backlog.',
      },
      {
        slug: 'sprints',
        label: 'Sprint Planning',
        icon: CalendarRange,
        phase: 4,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/sprints` : '/projects'),
        summary: 'Plan sprints against team capacity.',
      },
      {
        slug: 'kanban',
        label: 'Development Kanban',
        icon: Columns3,
        phase: 4,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/kanban` : '/projects'),
        summary: 'Track development work from To-do to Completed.',
      },
    ],
  },
  {
    label: 'Quality Assurance',
    modules: [
      {
        slug: 'business-testing',
        label: 'Business Testing',
        icon: ClipboardCheck,
        phase: 5,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/testing` : '/projects'),
        summary: 'Execute UAT scenarios step by step and record results.',
      },
      {
        slug: 'defects',
        label: 'Defect Tracking',
        icon: Bug,
        phase: 5,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/defects` : '/projects'),
        summary: 'Manage defects raised from testing.',
      },
    ],
  },
  {
    label: 'Analytics',
    modules: [
      {
        slug: 'dashboard',
        label: 'Delivery Dashboard',
        icon: BarChart3,
        phase: 6,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/dashboard` : '/projects'),
        summary: 'Sprint velocity, burndown, workload and UAT progress from stored delivery data.',
      },
      {
        slug: 'insights',
        label: 'Requirement Insights',
        icon: Lightbulb,
        phase: 7,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/insights` : '/projects'),
        summary: 'Consistency checks, change impact analysis and process improvement recommendations.',
      },
      {
        slug: 'traceability',
        label: 'Traceability',
        icon: Waypoints,
        phase: 7,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/trace` : '/projects'),
        summary: 'From each process activity to its data, rules, stories, tests and defects.',
      },
    ],
  },
  {
    label: 'Administration',
    modules: [
      {
        slug: 'projects',
        label: 'Projects',
        icon: FolderKanban,
        phase: 1,
        implemented: true,
        path: () => '/projects',
        summary: 'Create projects and manage who can access them.',
      },
      {
        slug: 'users',
        label: 'Users & Roles',
        icon: Users,
        phase: 7,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/members` : '/projects'),
        summary: 'Project members, their roles and what each role may do.',
      },
      {
        slug: 'settings',
        label: 'Settings',
        icon: Settings,
        phase: 7,
        implemented: true,
        path: (projectId) => (projectId ? `/projects/${projectId}/settings` : '/projects'),
        summary: 'Project details and delivery workflow rules.',
      },
    ],
  },
];

export function findModule(slug: string): NavModule | undefined {
  return NAVIGATION.flatMap((g) => g.modules).find((m) => m.slug === slug);
}
