# Bóveda local

Una bóveda de contraseñas que funciona sin cuenta ni servidor. Los datos quedan en el navegador donde se crean; el proyecto no transmite ni sincroniza contraseñas.

## Uso

1. Elegí una clave maestra larga que puedas recordar.
2. Ponéle un nombre a la bóveda, por ejemplo **Personal**, **Trabajo** o **Familia**.
3. Guardá o generá una contraseña por cada servicio.
4. Descargá una copia cifrada desde **Exportar** y guardala en un lugar seguro.

La clave maestra no se guarda. Si se pierde, la bóveda no puede recuperarse.

Podés crear varias bóvedas independientes. Cada una tiene su propio nombre y su propia clave maestra. Una copia importada se agrega como una bóveda nueva y nunca reemplaza las existentes.

## Protección aplicada

- El contenido se guarda cifrado en IndexedDB, no en texto plano.
- La clave de cifrado se deriva de la clave maestra con PBKDF2-HMAC-SHA-256 y 600.000 iteraciones.
- El contenido se cifra con AES-256-GCM y un IV nuevo cada vez que se guarda.
- La bóveda se bloquea tras cinco minutos sin actividad y al pulsar **Bloquear**.
- Las contraseñas generadas usan `crypto.getRandomValues`.
- La clave maestra puede cambiarse desde una bóveda desbloqueada.
- Las copias exportadas permanecen cifradas y conservan el nombre de la bóveda.

## Límites importantes

Este es un proyecto personal y no reemplaza a un gestor de contraseñas auditado. No guarda una copia en la nube ni ofrece recuperación de la clave maestra. La protección depende también de la seguridad del navegador y del dispositivo.

Los nombres de las bóvedas quedan visibles localmente para poder elegir una antes de desbloquearla; su contenido permanece cifrado. Al cambiar una clave maestra, las copias exportadas anteriormente siguen necesitando la clave anterior.
