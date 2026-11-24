import { createClient } from '@supabase/supabase-js';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Falten les variables SUPABASE_URL o SUPABASE_SECRET_KEY a Netlify.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const handler = async (event) => {
  try {
    const supabase = getConfig();

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('reservas').select('barrio,fecha');
      if (error) throw error;
      const counts = {};
      for (const row of data || []) {
        const date = String(row.fecha).slice(0, 10);
        const key = `${row.barrio}|${date}`;
        counts[key] = (counts[key] || 0) + 1;
      }
      return reply(200, { counts });
    }

    if (event.httpMethod === 'POST') {
      let input;
      try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { ok: false, error: 'Les dades del formulari no són vàlides.' }); }
      
      const nombre = String(input.nombre || '').trim();
      const email = String(input.email || '').trim().toLowerCase();
      const barrio = String(input.barrio || '').trim();
      const fecha = String(input.fecha || '').trim();
      const tipoObjeto = String(input.tipoObjeto || '').trim();
      const cantidad = parseInt(input.cantidad, 10);
      const descripcion = String(input.descripcion || '').trim();

      if (nombre.length < 3 || nombre.length > 60 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120 || !barrio || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !tipoObjeto || isNaN(cantidad) || cantidad < 1) {
        return reply(400, { ok: false, error: 'Revisa les dades del formulari, el tipus d’objecte i la quantitat.' });
      }

      const validAreas = [
        'Marianao', 'Ciutat Cooperativa i Molí Nou', 'Centre', 'Vinyets i Molí Vell',
        'Camps Blancs i Casablanca', 'Parc de Marianao, Can Paulet-Pedres Blanques i Canons-Les Orioles'
      ];
      if (!validAreas.includes(barrio)) return reply(400, { ok: false, error: 'El barri seleccionat no és vàlid.' });

      const { data, error } = await supabase.rpc('crear_reserva', {
        p_nombre: nombre, 
        p_email: email, 
        p_barrio: barrio, 
        p_fecha: fecha,
        p_tipo_objeto: tipoObjeto,
        p_cantidad: cantidad,
        p_descripcion: descripcion
      });
      
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.codigo) return reply(409, { ok: false, error: result?.mensaje || 'No s’ha pogut crear la reserva.' });

      let aviso = '';
      const resendKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM || 'Sant Boi Net <onboarding@resend.dev>';
      
      if (resendKey) {
        const dateParts = fecha.split('-');
        const readableDate = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        try {
          const mailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from,
              to: [email],
              subject: 'La teva reserva de Sant Boi Net',
              html: `
                <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#183b2d">
                  <h2 style="color:#176044">Sant Boi Net</h2>
                  <p>Hola, ${escapeHtml(nombre)}!</p>
                  <p>La teva reserva de voluminosos s’ha registrat correctament.</p>
                  <ul>
                    <li><b>Barri:</b> ${escapeHtml(barrio)}</li>
                    <li><b>Data:</b> ${readableDate}</li>
                    <li><b>Horari:</b> 20:00–22:00</li>
                    <li><b>Tipus d'objecte:</b> ${escapeHtml(tipoObjeto)}</li>
                    <li><b>Quantitat:</b> ${cantidad}</li>
                    ${descripcion ? `<li><b>Descripció:</b> ${escapeHtml(descripcion)}</li>` : ''}
                    <li><b>Codi:</b> ${result.codigo}</li>
                  </ul>
                  <p>Deixa els mobles al costat de l’entrada de l’edifici, no al costat dels contenidors.</p>
                  <p>Gràcies per ajudar a mantenir Sant Boi net.</p>
                  <p><b>Sant Boi Net</b></p>
                  <hr><small>Projecte escolar demostratiu; no és una reserva oficial de l’Ajuntament.</small>
                </div>
              `
            })
          });
          if (!mailResponse.ok) {
            const detail = await mailResponse.text();
            console.error('Resend error:', detail);
            aviso = 'La reserva s’ha guardat, però no s’ha pogut enviar el correu. Comprova la configuració de Resend.';
          }
        } catch (mailError) {
          console.error('Email send failed:', mailError);
          aviso = 'La reserva s’ha guardat, però hi ha hagut un problema en enviar el correu.';
        }
      } else {
        aviso = 'La reserva s’ha guardat, però encara no s’ha configurat el correu de Resend.';
      }
      return reply(200, { ok: true, codigo: result.codigo, aviso });
    }

    if (event.httpMethod === 'DELETE') {
      let input;
      try { input = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Dades no vàlides.' }); }
      const codigo = String(input.codigo || '').trim();
      const email = String(input.email || '').trim().toLowerCase();
      if (!codigo || !email) return reply(400, { error: 'Cal indicar el codi i el correu de la reserva.' });
      
      const { data, error } = await supabase.from('reservas').delete().eq('codigo', codigo).eq('email', email).select('id');
      if (error) throw error;
      if (!data?.length) return reply(404, { error: 'No s’ha trobat cap reserva amb aquest codi i correu.' });
      return reply(200, { ok: true });
    }

    return reply(405, { error: 'Mètode no permès.' });
  } catch (error) {
    console.error('Function reservas error:', error);
    return reply(500, { ok: false, error: 'Error del servidor. Revisa les variables i la configuració de Supabase a Netlify.' });
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[char]));
}
