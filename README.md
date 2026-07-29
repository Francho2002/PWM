# Bóveda local

Una bóveda de contraseñas que funciona sin cuenta ni servidor. Los datos quedan en el navegador donde se crean; el proyecto no transmite ni sincroniza contraseñas.

## Uso

1. Elegí una clave maestra larga que puedas recordar.
2. Ponéle un nombre a la bóveda, por ejemplo **Personal**, **Trabajo** o **Familia**.
3. Guardá o generá una contraseña por cada servicio.
4. Descargá una copia cifrada desde **Exportar** y guardala en un lugar seguro.

### Archivo llave en pendrive (opcional)

Desde una bóveda abierta, elegí **Archivo llave USB** e ingresá la clave maestra actual. Se descargará un pequeño archivo JSON para guardar en tu pendrive. Luego, en la pantalla bloqueada, elegí **Entrar con archivo USB**: PWM encontrará y abrirá automáticamente la bóveda vinculada con ese archivo.

La clave maestra sigue siendo el método de respaldo y también se pide para crear, reemplazar o desactivar un archivo llave. **No guardes el archivo llave junto con una copia cifrada de la bóveda:** quien tenga ambos podrá abrirla. El archivo llave no contiene la clave maestra, pero funciona como una llave de posesión y se puede copiar.

La clave maestra no se guarda. Si la perdés, sólo podrás entrar si todavía conservás el archivo llave activo de esa bóveda. Sin ninguno de los dos métodos, el contenido no puede recuperarse.

Podés crear varias bóvedas independientes. Cada una tiene su propio nombre y su propia clave maestra. PWM rechaza nombres repetidos, copias ya importadas y exportaciones de una bóveda que ya existe en el navegador.

Desde una bóveda abierta también podés elegir **Borrar bóveda**. La eliminación exige escribir su nombre exacto y sólo borra la copia de ese navegador: las exportaciones y los archivos llave USB continúan existiendo.

## Protección aplicada

- El contenido se guarda cifrado en IndexedDB, no en texto plano.
- Cada bóveda nueva usa una clave aleatoria de datos (DEK) de 256 bits para cifrar el contenido con AES-256-GCM y un IV nuevo cada vez que se guarda.
- La DEK se envuelve con una clave derivada de la clave maestra mediante PBKDF2-HMAC-SHA-256 y 600.000 iteraciones. La clave maestra no se guarda.
- Opcionalmente, la misma DEK puede envolverse con el secreto aleatorio de un archivo llave. Los contextos de cifrado separan contenido, clave maestra y archivo llave.
- La bóveda se bloquea tras cinco minutos sin actividad y al pulsar **Bloquear**.
- Las contraseñas generadas usan `crypto.getRandomValues`.
- La clave maestra puede cambiarse desde una bóveda desbloqueada.
- Las copias exportadas permanecen cifradas y conservan el nombre de la bóveda.
- Cada bóveda tiene un identificador persistente para impedir que una misma exportación se importe varias veces.

## Límites importantes

Este es un proyecto personal y no reemplaza a un gestor de contraseñas auditado. No guarda una copia en la nube ni permite restablecer una clave maestra olvidada. La protección depende también de la seguridad del navegador y del dispositivo.

Los nombres de las bóvedas quedan visibles localmente para poder elegir una antes de desbloquearla; su contenido permanece cifrado. Al cambiar una clave maestra, las copias exportadas anteriormente siguen necesitando la clave anterior, aunque también podrán abrirse con el archivo llave que estuviera activo cuando se exportaron.

Las bóvedas creadas con versiones anteriores se actualizan al nuevo formato la primera vez que se desbloquean correctamente con su clave maestra. Las copias cifradas y el archivo llave pueden importarse o seleccionarse en otro navegador: el archivo llave se vincula al contenido cifrado, no al identificador local de esa instalación. Reemplazar un archivo llave afecta a la bóveda actual y a las futuras exportaciones; no modifica las copias descargadas anteriormente.
