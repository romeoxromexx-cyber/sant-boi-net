-- Ejecuta este SQL en Supabase > SQL Editor > New query.
create table if not exists public.reservas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text not null,
  barrio text not null,
  fecha date not null,
  codigo text not null unique,
  created_at timestamptz not null default now()
);
alter table public.reservas enable row level security;

-- La función hace el control de capacidad y duplicados en una única operación.
create or replace function public.crear_reserva(
  p_nombre text, p_email text, p_barrio text, p_fecha date
) returns table(codigo text, mensaje text)
language plpgsql security definer set search_path = public
as $$
declare v_count integer; v_code text;
begin
  perform pg_advisory_xact_lock(hashtext(p_barrio || '|' || p_fecha::text));
  if p_fecha < current_date then return query select null::text, 'La fecha ya ha pasado.'; return; end if;
  if exists (select 1 from reservas r where lower(r.email)=lower(p_email) or lower(trim(r.nombre))=lower(trim(p_nombre))) then
    return query select null::text, 'Ya existe una reserva activa con ese nombre o correo.'; return;
  end if;
  select count(*) into v_count from reservas r where r.barrio=p_barrio and r.fecha=p_fecha;
  if v_count >= 20 then return query select null::text, 'No quedan plazas para ese día.'; return; end if;
  v_code := 'SBN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into reservas(nombre,email,barrio,fecha,codigo) values(trim(p_nombre),lower(trim(p_email)),p_barrio,p_fecha,v_code);
  return query select v_code, ''::text;
end;
$$;
revoke all on function public.crear_reserva(text,text,text,date) from public, anon, authenticated;
