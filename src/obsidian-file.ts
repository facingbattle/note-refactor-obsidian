import { App, Notice, Vault, normalizePath, TFile, TFolder } from 'obsidian';
import { NoteRefactorSettings, Location } from './settings';
import MomentDateRegex from './moment-date-regex'
import NRFile from './file';

export default class ObsidianFile {
    private settings: NoteRefactorSettings;
    private vault: Vault;
    private app: App;
    private file: NRFile;
    private momentDateRegex: MomentDateRegex;

    constructor(setting: NoteRefactorSettings, app: App) {
        this.settings = setting;
        this.app = app;
        this.vault = app.vault;
        this.file = new NRFile(this.settings);
        this.momentDateRegex = new MomentDateRegex();
    }

    filePath(view: any) : string {
        let path = '';
        switch(this.settings.newFileLocation){
          case Location.VaultFolder:
            path = this.vault.getRoot().path;
            break;
          case Location.SameFolder:
            path = view.file.parent.path;
            break;
          case Location.SpecifiedFolder:
            path = this.momentDateRegex.replace(this.settings.customFolder);
            break;
        }
        return normalizePath(path);
    }
  
    filePathAndFileName(fileName: string, view: any): string {
      return normalizePath(`${this.filePath(view)}/${fileName}.md`);
    }

    async createOrAppendFile(fileName: string, note: string) {
      const view = this.app.workspace.activeLeaf.view;
      const folderPath = this.filePath(view);
      const filePath = this.filePathAndFileName(fileName, view);
      //Check if folder exists and create if needed
      const folderExists = await this.vault.adapter.exists(folderPath, false);
      if(!folderExists) {
        const folders = folderPath.split('/');
        try {
          await this.createFoldersFromVaultRoot('', folders);
        } catch (error) {
          console.error(error)
        }
      }
      try {
        //If files exists then append conent to existing file
        const fileExists = await this.vault.adapter.exists(filePath);
        if(fileExists){
          await this.appendFile(filePath, note);
        } else {
          await this.vault.create(filePath, note);
        }
        return filePath;
      } catch (error) {
        console.error(error);
      }
    }

    async appendFile(filePath: string, note: string) {
      let existingContent = await this.app.vault.adapter.read(filePath);
      if(existingContent.length > 0) {
        existingContent = existingContent + '\r\r';
      }
      await this.vault.adapter.write(filePath, existingContent + note);
    }
  
    private getTemplaterPlugin(): any | null {
      const templaterPlugin = (this.app as any).plugins?.plugins?.['templater-obsidian'];
      if (templaterPlugin && templaterPlugin.templater) {
        return templaterPlugin;
      }
      return null;
    }

    async createNoteWithTemplater(fileName: string, folderPath: string, content: string): Promise<string | undefined> {
      if (!this.settings.useTemplaterTemplate || !this.settings.templaterTemplateFile) {
        return undefined;
      }
      const templaterPlugin = this.getTemplaterPlugin();
      if (!templaterPlugin) {
        new Notice('Templater plugin is not installed or enabled. Falling back to default note creation.');
        return undefined;
      }
      const templateFile = this.vault.getAbstractFileByPath(normalizePath(this.settings.templaterTemplateFile));
      if (!templateFile || !(templateFile instanceof TFile)) {
        new Notice(`Templater template file not found: ${this.settings.templaterTemplateFile}`);
        return undefined;
      }
      try {
        const folderExists = await this.vault.adapter.exists(folderPath, false);
        if (!folderExists) {
          await this.createFoldersFromVaultRoot('', folderPath.split('/'));
        }
        const folder = folderPath ? this.vault.getAbstractFileByPath(folderPath) : this.vault.getRoot();
        const newFile: TFile = await templaterPlugin.templater.create_new_note_from_template(
          templateFile,
          folder instanceof TFolder ? folder : this.vault.getRoot(),
          fileName,
          false
        );
        if (!newFile) {
          new Notice('Templater failed to create the new note.');
          return undefined;
        }
        const existingContent = await this.vault.read(newFile);
        let updatedContent: string;
        if (existingContent.includes('{{new_note_content}}')) {
          updatedContent = existingContent.replace('{{new_note_content}}', content);
        } else {
          const separator = existingContent.trim().length > 0 ? '\r\r' : '';
          updatedContent = existingContent + separator + content;
        }
        await this.vault.modify(newFile, updatedContent);
        return newFile.path;
      } catch (error) {
        console.error(error);
        new Notice('Error creating note via Templater. Falling back to default note creation.');
        return undefined;
      }
    }

    private async createFoldersFromVaultRoot(parentPath: string, folders: string[]): Promise<void> {
      if(folders.length === 0) {
        return;
      }
      const newFolderPath = normalizePath([parentPath, folders[0]].join('/'));
      const folderExists = await this.vault.adapter.exists(newFolderPath, false)
        folders.shift();
        if(folderExists) {
          await this.createFoldersFromVaultRoot(newFolderPath, folders);
        } else {
          await this.vault.createFolder(newFolderPath);
          await this.createFoldersFromVaultRoot(newFolderPath, folders)
        }
    }
}