# Bóveda local

Una bóveda de contraseñas que funciona sin cuenta ni servidor. Los datos quedan en cada navegador y PWM nunca los transmite por su cuenta. La sincronización entre dispositivos es manual y se realiza con copias cifradas elegidas por el usuario.

## Uso

1. Elegí una clave maestra larga que puedas recordar.
2. Ponéle un nombre a la bóveda, por ejemplo **Personal**, **Trabajo** o **Familia**.
3. Guardá o generá una contraseña por cada servicio.
4. Descargá una copia cifrada desde **Exportar** y guardala en un lugar seguro. Los archivos se numeran por bóveda, por ejemplo `personal-boveda-v1.pwm.json`, `personal-boveda-v2.pwm.json`, etc. En navegadores con selector de carpetas, desde la v2 PWM exige la misma carpeta: valida la versión anterior, guarda y comprueba la nueva y recién entonces retira la anterior. Nunca sobrescribe una copia distinta; si no puede comprobar o borrar con seguridad, conserva los archivos y mantiene el aviso correspondiente.

Cuando agregás, modificás o eliminás una contraseña, PWM muestra un aviso urgente y resalta **Exportar** hasta que guardes una nueva versión para tu USB. Es necesario hacerlo: si perdés el navegador o el dispositivo antes, las copias anteriores no tendrán las credenciales recientes. Al cambiar la clave maestra, las copias previas sólo abrirán con la clave anterior; exportá una nueva inmediatamente.

PWM no marca una copia como realizada sólo por haber iniciado una descarga. Si el navegador permite elegir el destino, espera a que el archivo termine de escribirse y lo comprueba. En navegadores que sólo ofrecen descargas, PWM mantiene el aviso pendiente y pide seleccionar de nuevo la copia recién guardada antes de confirmarla. Si no podés comprobarla, el estado seguro es que el respaldo sigue pendiente.

Si intentás cerrar, recargar o salir del sitio con una copia pendiente, el navegador mostrará su confirmación nativa de cambios sin guardar. Dentro de PWM, bloquear, volver al inicio o borrar una bóveda también ofrecen exportar antes de continuar. Estos avisos son una última barrera: el navegador puede permitir que sigas sin copia y no reemplazan el respaldo.

### Sincronizar PC y teléfono

**Sincronizar** combina los cambios hechos por separado en dos dispositivos sin reemplazar ciegamente una bóveda completa. El flujo es manual porque PWM no usa cuentas ni un servidor central:

1. En el teléfono, exportá una copia cifrada reciente de la bóveda.
2. Llevá ese archivo al PC por el medio que prefieras y, con la misma bóveda abierta, elegí **Sincronizar → Fusionar copia**.
3. Revisá el resumen. Los cambios independientes se combinan automáticamente. Si ambos dispositivos modificaron la misma credencial, o uno la eliminó mientras el otro la editaba, PWM exige que elijas qué versión conservar. Las contraseñas no se muestran en esa pantalla.
4. Aplicá la fusión y exportá inmediatamente la bóveda resultante.
5. En el teléfono, abrí esa misma bóveda y repetí **Sincronizar → Fusionar copia** con el archivo nuevo. Así ambos dispositivos terminan con el mismo estado.

PWM sólo acepta copias que pertenezcan exactamente a la bóveda abierta. El archivo se procesa localmente y no se sube a internet. La clave maestra y el archivo llave USB de cada dispositivo no se reemplazan durante la fusión. Las modificaciones usan contadores por dispositivo, no la hora del reloj, y las eliminaciones viajan cifradas para que una credencial borrada no reaparezca al sincronizar.

Antes de aplicar, PWM muestra cuántas credenciales se agregarán, actualizarán o eliminarán. La última fusión puede deshacerse mientras no hagas otro cambio en la bóveda; el punto de restauración queda cifrado localmente y se elimina automáticamente con la siguiente modificación.

### Archivo llave en pendrive (opcional)

Desde una bóveda abierta, elegí **Archivo llave USB** e ingresá la clave maestra actual. PWM prepara un pequeño archivo JSON numerado, por ejemplo `personal-llave-v1.json`, `personal-llave-v2.json`, etc., para guardar en tu pendrive. La llave nueva no se activa todavía: primero debe guardarse y comprobarse. Si cancelás, se bloquea la página o falla la escritura, la llave anterior sigue activa y la nueva no sirve. Luego, en la pantalla bloqueada, seleccioná la bóveda y elegí **Importar llave**. PWM sólo la abrirá si el archivo pertenece exactamente a la bóveda seleccionada; una llave de otra bóveda se rechaza y se identifica claramente.

La clave maestra sigue siendo el método de respaldo y también se pide para crear, reemplazar o desactivar un archivo llave. **No guardes el archivo llave junto con una copia cifrada de la bóveda:** quien tenga ambos podrá abrirla. El archivo llave no contiene la clave maestra, pero funciona como una llave de posesión y se puede copiar.

La clave maestra no se guarda. Si la perdés, sólo podrás entrar si todavía conservás el archivo llave activo de esa bóveda. Sin ninguno de los dos métodos, el contenido no puede recuperarse.

Podés crear varias bóvedas independientes. Cada una tiene su propio nombre y su propia clave maestra. PWM rechaza nombres repetidos, copias ya importadas y exportaciones de una bóveda que ya existe en el navegador.

Desde una bóveda abierta también podés elegir **Borrar bóveda**. La eliminación exige escribir su nombre exacto y sólo borra la copia de ese navegador: las exportaciones y los archivos llave USB continúan existiendo.

### Historial cifrado

**Mostrar historial** permite revisar los cambios importantes de cada bóveda: contraseñas agregadas, actualizadas o eliminadas, cambios de clave maestra y creación o desactivación de llaves USB. El historial forma parte del contenido cifrado de la bóveda y viaja con sus copias exportadas.

PWM no guarda en el historial las contraseñas, los nombres de usuario ni acciones como copiar, mostrar, desbloquear o exportar. Se conservan los últimos 200 movimientos para evitar que la bóveda crezca indefinidamente. Las bóvedas creadas con versiones anteriores comienzan con un historial vacío y registran los cambios nuevos.

### Apariencia de la bóveda

Con una bóveda abierta, **Personalizar** permite elegir entre colores, gradientes, patrones y fondos fotográficos locales. La elección es exclusiva de esa bóveda y se cifra dentro de ella: se conserva al cambiar de dispositivo mediante una exportación e importación posteriores. Cambiar el fondo no modifica credenciales ni activa el aviso urgente de respaldo.

Las pantallas de inicio y desbloqueo usan fondos neutros locales que rotan aproximadamente cada diez segundos. No se guardan ni pertenecen a ninguna bóveda; al abrir una se reemplazan por su apariencia cifrada. Si el dispositivo solicita reducir movimiento, se muestra un único fondo sin rotación.

## Protección aplicada

- El contenido se guarda cifrado en IndexedDB, no en texto plano.
- El historial de movimientos se cifra junto con las credenciales; no se almacena como un registro separado en texto plano.
- Cada bóveda nueva usa una clave aleatoria de datos (DEK) de 256 bits para cifrar el contenido con AES-256-GCM y un IV nuevo cada vez que se guarda.
- La DEK se envuelve con una clave derivada de la clave maestra mediante PBKDF2-HMAC-SHA-256 y 600.000 iteraciones. La clave maestra no se guarda.
- Opcionalmente, la misma DEK puede envolverse con el secreto aleatorio de un archivo llave. Los contextos de cifrado separan contenido, clave maestra y archivo llave.
- La bóveda se bloquea tras quince minutos sin actividad y al pulsar **Bloquear**.
- La bóveda también se bloquea al abandonar la página y si el navegador intenta restaurarla desde su caché de navegación.
- Una misma bóveda no puede quedar abierta en dos pestañas a la vez: PWM reserva la sesión de edición y rechaza el segundo desbloqueo para evitar escrituras en conflicto.
- Las contraseñas generadas usan `crypto.getRandomValues`.
- La clave maestra puede cambiarse desde una bóveda desbloqueada.
- Las copias exportadas permanecen cifradas y conservan el nombre de la bóveda.
- La apariencia elegida de cada bóveda se cifra con el resto de su contenido y se incluye en las exportaciones.
- Cada bóveda tiene un identificador persistente para impedir que una misma exportación se importe varias veces.
- Las importaciones de copias cifradas se limitan a 50 MiB antes de leerlas en memoria.
- La página usa una política CSP restrictiva: no carga scripts, estilos, imágenes ni conexiones de terceros (`connect-src 'none'`).

## Límites importantes

Este es un proyecto personal y no reemplaza a un gestor de contraseñas auditado. No guarda una copia en la nube ni permite restablecer una clave maestra olvidada. La protección depende también de la seguridad del navegador y del dispositivo.

Los nombres de las bóvedas quedan visibles localmente para poder elegir una antes de desbloquearla; su contenido permanece cifrado. Al cambiar una clave maestra, las copias exportadas anteriormente siguen necesitando la clave anterior, aunque también podrán abrirse con el archivo llave que estuviera activo cuando se exportaron.

Las bóvedas creadas con versiones anteriores se actualizan al nuevo formato la primera vez que se desbloquean correctamente con su clave maestra. Las copias cifradas y el archivo llave pueden importarse o seleccionarse en otro navegador: el archivo llave se vincula al contenido cifrado, no al identificador local de esa instalación. Reemplazar un archivo llave afecta a la bóveda actual y a las futuras exportaciones; no modifica las copias descargadas anteriormente.

La posibilidad de elegir directamente la carpeta de guardado depende del navegador. Cuando no está disponible, PWM no puede saber si una descarga llegó al disco; por eso exige seleccionar otra vez el archivo descargado para comprobarlo. Ejecutá PWM en un origen HTTPS dedicado, sin analíticas, extensiones o scripts de terceros. Ninguna aplicación web puede proteger una bóveda ya abierta frente a código malicioso que se ejecute con el mismo origen.
