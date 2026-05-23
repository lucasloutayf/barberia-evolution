const { barberia_id, dominio, nombre } = (await import('../barberia.config.js')).default

if (!dominio) {
  console.error('Error: falta el campo "dominio" en barberia.config.js')
  process.exit(1)
}

const url = `${process.env.VITE_SUPABASE_URL}/rest/v1/barberias`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type':  'application/json',
    'apikey':        process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer':        'resolution=merge-duplicates',
  },
  body: JSON.stringify({ barberia_id, dominio, nombre }),
})

if (!res.ok) {
  console.error('Error:', await res.text())
  process.exit(1)
}
console.log(`✓ ${nombre} registrada → ${dominio}`)
