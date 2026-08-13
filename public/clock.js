(() => {
  const updateClock = () => {
    const now = new Date()
    const sec = now.getSeconds()
    const min = now.getMinutes() + sec / 60
    const hour = (now.getHours() % 12) + min / 60

    document.querySelectorAll('.hand-hour').forEach((el) => {
      el.style.transform = `rotate(${hour * 30}deg)`
    })
    document.querySelectorAll('.hand-minute').forEach((el) => {
      el.style.transform = `rotate(${min * 6}deg)`
    })
    document.querySelectorAll('.hand-second').forEach((el) => {
      el.style.transform = `rotate(${sec * 6}deg)`
    })

    const digitalTime = now.toLocaleTimeString('ar', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const digitalDate = now.toLocaleDateString('ar', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    ;['siteAnalogTime', 'panelClockTime', 'miniClockTime', 'deployClockTime'].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.textContent = digitalTime
    })

    ;['siteAnalogDate', 'panelClockDate', 'miniClockDate', 'deployClockDate'].forEach((id) => {
      const el = document.getElementById(id)
      if (el) el.textContent = digitalDate
    })
  }

  updateClock()
  setInterval(updateClock, 1000)
})()
