import { withMermaid } from 'vitepress-plugin-mermaid'
import type { DefaultTheme } from 'vitepress/theme'

const gettingStartedSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '开始使用',
    items: [
      { text: '认识 Felis', link: '/' },
      { text: '安装与部署', link: '/guide/deployment' },
      { text: '管理服务器', link: '/guide/servers' },
    ],
  },
  {
    text: '项目资料',
    collapsed: true,
    items: [
      { text: '开源协议', link: '/reference/license' },
      { text: '项目说明', link: '/reference/readme-en' },
    ],
  },
]

const operationsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '部署与运维',
    items: [
      { text: '部署架构', link: '/reference/architecture' },
      { text: '运维手册', link: '/operations/' },
      { text: '备份与恢复', link: '/operations/backup' },
      { text: '故障排查', link: '/operations/troubleshooting' },
      { text: '多机部署（实验性）', link: '/guide/distributed' },
    ],
  },
]

const developmentSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: '开发参考',
    items: [
      { text: '从源码构建', link: '/guide/building' },
      { text: '贡献指南', link: '/reference/contributing' },
      { text: 'API 定义', link: '/reference/api' },
      { text: '时序图', link: '/reference/sequence-diagrams' },
      { text: '服务端插件', link: '/reference/plugins' },
      { text: '集成边界', link: '/reference/deferred-seams' },
    ],
  },
  {
    text: '镜像参考',
    collapsed: true,
    items: [
      { text: '大厅镜像', link: '/reference/lobby' },
      { text: '登录服镜像', link: '/reference/limbo' },
    ],
  },
]

const sidebar: Record<string, DefaultTheme.SidebarItem[]> = {
  '/guide/distributed': operationsSidebar,
  '/guide/building': developmentSidebar,
  '/reference/architecture': operationsSidebar,
  '/reference/license': gettingStartedSidebar,
  '/reference/readme-en': gettingStartedSidebar,
  '/operations/': operationsSidebar,
  '/reference/': developmentSidebar,
  '/': gettingStartedSidebar,
}

const englishLabels: Record<string, string> = {
  '开始使用': 'Getting started',
  '认识 Felis': 'Introduction to Felis',
  '安装与部署': 'Installation and deployment',
  '管理服务器': 'Managing servers',
  '项目资料': 'Project information',
  '开源协议': 'License',
  '项目说明': 'Project README',
  '部署与运维': 'Deployment and operations',
  '部署架构': 'Deployment architecture',
  '运维手册': 'Operations guide',
  '备份与恢复': 'Backup and restore',
  '故障排查': 'Troubleshooting',
  '多机部署（实验性）': 'Multi-node deployment (experimental)',
  '开发参考': 'Developer reference',
  '从源码构建': 'Build from source',
  '贡献指南': 'Contributing',
  'API 定义': 'API definition',
  '时序图': 'Sequence diagrams',
  '服务端插件': 'Server-side plugins',
  '集成边界': 'Integration boundaries',
  '镜像参考': 'Image reference',
  '大厅镜像': 'Lobby image',
  '登录服镜像': 'Login server image',
}

function englishSidebar(items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem[] {
  return items.map(item => ({
    ...item,
    text: item.text && englishLabels[item.text],
    items: item.items && englishSidebar(item.items),
  }))
}

export default withMermaid({
  title: 'Felis 文档',
  titleTemplate: ':title · Felis 文档',
  description: 'Felis 文档：Kubernetes 驱动的 Minecraft 服务器托管，从部署到唤醒、备份与恢复。',
  lang: 'zh-CN',
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: {
      label: 'English',
      lang: 'en',
      title: 'Felis Docs',
      titleTemplate: ':title · Felis Docs',
      description: 'Documentation for Felis, a Kubernetes-driven Minecraft server hosting platform.',
      themeConfig: {
        nav: [
          { text: 'Website', link: 'https://felismc.com/', target: '_self' },
          {
            text: 'Getting started',
            link: '/en/',
            activeMatch: '^/en/(?:$|guide/(?:deployment|servers)$|reference/(?:license|readme-en)$)',
          },
          {
            text: 'Operations',
            link: '/en/operations/',
            activeMatch: '^/en/(?:operations/|guide/distributed$|reference/architecture$)',
          },
          {
            text: 'Developer reference',
            link: '/en/reference/contributing',
            activeMatch: '^/en/(?:guide/building$|reference/(?!(?:architecture|license|readme-en)$))',
          },
        ],
        sidebar: Object.fromEntries(Object.entries(sidebar).map(([path, items]) => [
          '/en' + path,
          { base: '/en', items: englishSidebar(items) },
        ])),
        outline: { level: [2, 3], label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        editLink: {
          pattern: 'https://github.com/FelisMC/docs/edit/main/docs/:path',
          text: 'Edit this page on GitHub',
        },
        lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'medium' } },
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Back to top',
        langMenuLabel: 'Change language',
        skipToContentLabel: 'Skip to content',
        darkModeSwitchLabel: 'Theme',
        lightModeSwitchTitle: 'Switch to light theme',
        darkModeSwitchTitle: 'Switch to dark theme',
        notFound: {
          title: 'Page not found',
          quote: 'The page you are looking for does not exist.',
          linkLabel: 'Go to the home page',
          linkText: 'Back to documentation',
        },
        footer: { copyright: 'FelisMC · Built with VitePress' },
      },
    },
  },
  base: process.env.DOCS_BASE || '/',
  appearance: true,
  lastUpdated: true,
  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (...args) => fence(...args).replace(
        'title="Copy Code"',
        `title="${args[3].localeIndex === 'en' ? 'Copy code' : '复制代码'}"`,
      )
    },
  },
  mermaid: {
    sequence: { useMaxWidth: false, wrap: true },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#000000', media: '(prefers-color-scheme: dark)' }],
  ],
  vite: {
    optimizeDeps: {
      exclude: ['@nolebase/vitepress-plugin-enhanced-readabilities/client', 'vitepress', '@nolebase/ui'],
    },
    ssr: {
      noExternal: [
        '@nolebase/vitepress-plugin-enhanced-readabilities',
        '@nolebase/vitepress-plugin-highlight-targeted-heading',
        '@nolebase/ui',
      ],
    },
  },
  themeConfig: {
    logo: { src: '/felis-logo.png', alt: 'Felis' },
    nav: [
      { text: '官网', link: 'https://felismc.com/', target: '_self' },
      {
        text: '开始使用',
        link: '/',
        activeMatch: '^/(?:$|guide/(?:deployment|servers)$|reference/(?:license|readme-en)$)',
      },
      {
        text: '部署与运维',
        link: '/operations/',
        activeMatch: '^/(?:operations/|guide/distributed$|reference/architecture$)',
      },
      {
        text: '开发参考',
        link: '/reference/contributing',
        activeMatch: '^/(?:guide/building$|reference/(?!(?:architecture|license|readme-en)$))',
      },
    ],
    sidebar,
    socialLinks: [{ icon: 'github', link: 'https://github.com/FelisMC/docs' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          en: {
            translations: {
              button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' },
              modal: {
                displayDetails: 'Display detailed list',
                resetButtonTitle: 'Reset search',
                backButtonTitle: 'Close search',
                noResultsText: 'No results found',
                footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' },
              },
            },
          },
        },
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除搜索',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关内容',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { level: [2, 3], label: '本页内容' },
    docFooter: { prev: '上一页', next: '下一页' },
    editLink: {
      pattern: 'https://github.com/FelisMC/docs/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    langMenuLabel: '切换语言',
    skipToContentLabel: '跳至正文',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    notFound: {
      title: '页面不存在',
      quote: '你访问的页面不存在或已移动。',
      linkLabel: '返回文档首页',
      linkText: '返回文档',
    },
    footer: {
      copyright: 'FelisMC · 使用 VitePress 构建',
    },
  },
})
