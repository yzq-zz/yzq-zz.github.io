import DefaultTheme from 'vitepress/theme'
import RecallCode from '../components/RecallCode.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('RecallCode', RecallCode)
  }
}
