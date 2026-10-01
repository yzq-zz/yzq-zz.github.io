import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import RecallCode from '../components/RecallCode.vue'
import OutlineCollapse from '../components/OutlineCollapse.vue'
import AnchorComments from '../components/AnchorComments.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'aside-outline-after': () => h(OutlineCollapse),
      'doc-after': () => h(AnchorComments)
    }),
  enhanceApp({ app }) {
    app.component('RecallCode', RecallCode)
  }
}
