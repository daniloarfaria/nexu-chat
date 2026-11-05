import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Nome do produto mostrado ao usuário.
 * O nome INTERNO continua "Disparador": é dele que saem a pasta de dados (Application Support/Disparador,
 * %APPDATA%\Disparador) e o item do Keychain do Mac ("Disparador Safe Storage") que protege a sessão do
 * WhatsApp e as chaves. Trocar o nome interno faria todo mundo perder conexão e dados ao atualizar.
 */
export const PRODUCT_NAME = 'Nexu Chat'
const STORAGE_NAME = 'Disparador'

// Precisa rodar antes de qualquer uso de app.getPath ou do Keychain
app.setName(STORAGE_NAME)

export function setupAppMenu(): void {
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Agência Ark'
  })
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: PRODUCT_NAME,
        submenu: [
          { role: 'about', label: `Sobre o ${PRODUCT_NAME}` },
          sep,
          { role: 'hide', label: `Ocultar ${PRODUCT_NAME}` },
          { role: 'hideOthers', label: 'Ocultar outros' },
          { role: 'unhide', label: 'Mostrar tudo' },
          sep,
          { role: 'quit', label: `Encerrar ${PRODUCT_NAME}` }
        ]
      },
      {
        label: 'Editar',
        submenu: [
          { role: 'undo', label: 'Desfazer' },
          { role: 'redo', label: 'Refazer' },
          sep,
          { role: 'cut', label: 'Recortar' },
          { role: 'copy', label: 'Copiar' },
          { role: 'paste', label: 'Colar' },
          { role: 'selectAll', label: 'Selecionar tudo' }
        ]
      },
      {
        label: 'Visualizar',
        submenu: [
          { role: 'resetZoom', label: 'Tamanho real' },
          { role: 'zoomIn', label: 'Aumentar' },
          { role: 'zoomOut', label: 'Diminuir' },
          sep,
          { role: 'togglefullscreen', label: 'Tela cheia' }
        ]
      },
      {
        label: 'Janela',
        submenu: [
          { role: 'minimize', label: 'Minimizar' },
          { role: 'zoom', label: 'Zoom' },
          sep,
          { role: 'close', label: 'Fechar janela' }
        ]
      }
    ])
  )
}
