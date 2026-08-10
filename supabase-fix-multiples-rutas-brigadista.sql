-- Volanteo · soporte de múltiples rutas por brigadista en el mismo turno
-- Ejecutar UNA VEZ en Supabase > SQL Editor.

create or replace function public.field_get_assignments(p_brigadista_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  items jsonb;
begin
  if not public._field_pin_ok(p_brigadista_id,p_pin) then
    raise exception 'PIN incorrecto o brigadista inactivo';
  end if;

  select state into s from public.app_state where id='main';
  if s is null then
    return jsonb_build_object('assignments','[]'::jsonb);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'journey', jj - 'exercises',
        'exercise', ee - 'routes',
        'route', rr || jsonb_build_object(
          'status', coalesce(rx.status, rr->>'status', 'pending'),
          'progress', coalesce(rx.progress, nullif(rr->>'progress','')::integer, 0),
          'completedBlocks', coalesce(rx.completed_blocks, 0),
          'completedUnits', coalesce(rx.completed_units, rx.completed_blocks, 0),
          'startedAt', rx.started_at,
          'finishedAt', rx.finished_at,
          'lastPosition', rx.last_position,
          'lastPositionAt', rx.last_position_at,
          'lastProgressAt', rx.last_progress_at,
          'blockReports', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', rep.id,
                'number', rep.block_number,
                'reportedAt', rep.reported_at,
                'reportedBy', rep.reported_by,
                'brigadistaId', rep.brigadista_id,
                'lat', rep.lat,
                'lng', rep.lng
              ) order by rep.reported_at
            )
            from public.route_reports rep
            where rep.route_id = rr->>'id'
          ), '[]'::jsonb)
        )
      )
      order by
        case coalesce(rx.status, rr->>'status', 'pending')
          when 'live' then 0 else 1
        end,
        case
          when (ee->>'date')::date = current_date then 0
          when (ee->>'date')::date > current_date then 1
          else 2
        end,
        case coalesce(rx.status, rr->>'status', 'pending')
          when 'live' then 0
          when 'pending' then 1
          else 2
        end,
        abs((ee->>'date')::date - current_date),
        ee->>'time',
        rr->>'name'
    ),
    '[]'::jsonb
  ) into items
  from jsonb_array_elements(coalesce(s->'journeys','[]'::jsonb)) jj
  cross join lateral jsonb_array_elements(coalesce(jj->'exercises','[]'::jsonb)) ee
  cross join lateral jsonb_array_elements(coalesce(ee->'routes','[]'::jsonb)) rr
  left join public.route_runtime rx on rx.route_id = rr->>'id'
  where coalesce((jj->>'archived')::boolean,false)=false
    and coalesce(rr->'memberIds','[]'::jsonb) ? p_brigadista_id;

  return jsonb_build_object('assignments', items);
end;
$$;

revoke all on function public.field_get_assignments(text,text) from public;
grant execute on function public.field_get_assignments(text,text) to anon, authenticated;
