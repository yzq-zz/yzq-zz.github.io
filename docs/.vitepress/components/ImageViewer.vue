<template>
  <div class="image-viewer" v-if="visible" @click="close">
    <img :src="currentSrc" @click.stop />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)
const currentSrc = ref('')

const openImage = (e) => {
  const target = e.target.closest('img')
  if (target && target.src && !target.src.includes('data:image/svg')) {
    currentSrc.value = target.src
    visible.value = true
    document.body.style.overflow = 'hidden'
  }
}

const close = () => {
  visible.value = false
  document.body.style.overflow = ''
}

const handleKeydown = (e) => {
  if (e.key === 'Escape' && visible.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', openImage, true)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', openImage, true)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.image-viewer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: pointer;
}

.image-viewer img {
  max-width: 95vw;
  max-height: 95vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
</style>
