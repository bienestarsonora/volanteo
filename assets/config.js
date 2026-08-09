// Configuración de producción.
// 1) Crea tu proyecto Supabase.
// 2) Copia Project URL y Publishable key desde Project Settings > API / Connect.
// 3) Pega ambos valores aquí. La publishable key puede estar en el frontend;
//    la seguridad real la aplican RLS y las funciones SQL de /supabase/schema.sql.
window.VOLANTEO_CONFIG={
  APP_VERSION:'33.0.0',
  DEFAULT_CENTER:[29.0729,-110.9559],
  DEFAULT_ZOOM:13,
  SUPABASE_URL:'https://yurenojjafrbdnstnttd.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'sb_publishable_gSBuuFd8H4fg9VTehdbSzg_fh-dmnMn',
  OVERPASS_ENDPOINTS:[
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ],
  OVERPASS_TIMEOUT_MS:12000
};
